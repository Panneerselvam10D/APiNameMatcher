import React, { useState, useEffect } from 'react';
import { 
  Button, 
  CircularProgress, 
  Container, 
  Paper, 
  Table, 
  TableBody, 
  TableCell, 
  TableContainer, 
  TableHead, 
  TableRow,
  Typography,
  Snackbar,
  Alert,
  Box,
  Tabs,
  Tab
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import apiService from './services/apiService';

function App() {
  const [file, setFile] = useState(null);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tabValue, setTabValue] = useState(0);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    // Initialize by getting the first access token
    const initializeAuth = async () => {
      try {
        await apiService.getAccessToken();
        setInitializing(false);
      } catch (error) {
        console.error('Authentication failed:', error);
        showSnackbar('Failed to authenticate with the server', 'error');
        setInitializing(false);
      }
    };

    initializeAuth();
  }, []);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleProcessFile = async () => {
    if (!file) {
      showSnackbar('Please select a file first', 'warning');
      return;
    }
    
    if (initializing) {
      showSnackbar('Initializing authentication, please wait...', 'info');
      return;
    }

    setLoading(true);
    setResults([]);

    try {
      const data = await readExcel(file);
      const names = extractNames(data);
      
      // Process each name and update results in real-time
      for (let i = 0; i < names.length; i++) {
        const name = names[i];
        try {
          const result = await apiService.processName(name);
          
          // Compare SDN data between V2 and V4
          const sdnComparison = compareSdnData(result.v2, result.v4);
          
          // Update results with the new data
          setResults(prevResults => [
            ...prevResults,
            {
              name,
              v2: result.v2,
              v4: result.v4,
              _totalDuration: result._totalDuration,
              _sdnComparison: sdnComparison,
              id: `${name}-${Date.now()}-${i}` // Add a unique ID for each result
            }
          ]);
          
          // Show a snackbar for the first few results or on completion
          if (i === 0) {
            showSnackbar('Processing started. Results will appear below as they are ready.', 'info');
          }
        } catch (error) {
          console.error(`Error processing name: ${name}`, error);
          // Add a failed entry to results
          setResults(prevResults => [
            ...prevResults,
            {
              name,
              error: `Error: ${error.message}`,
              id: `${name}-error-${Date.now()}-${i}`
            }
          ]);
        }
      }
      
      showSnackbar('All names processed!', 'success');
    } catch (error) {
      console.error('Error processing file:', error);
      showSnackbar('Failed to process file. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const readExcel = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
          resolve(jsonData);
        } catch (error) {
          reject(error);
        }
      };
      reader.readAsArrayBuffer(file);
    });
  };

  const extractNames = (data) => {
    return data.slice(1).map(row => row[0]).filter(Boolean);
  };

  // Helper function to compare SDN data between V2 and V4
  const compareSdnData = (v2Data, v4Data) => {
    // Extract unique SDN IDs from V2 and V4
    const v2Sdns = new Set(
      (v2Data?.responses || [])
        .flatMap(item => item.rulesDetails?.sdnid || [])
        .filter(Boolean)
    );
    
    const v4Sdns = new Set(
      (v4Data?.responses || [])
        .flatMap(item => item.rulesDetails?.sdnid || [])
        .filter(Boolean)
    );

    // Find SDNs in V2 but not in V4
    const onlyInV2 = [];
    v2Sdns.forEach(sdnId => {
      if (!v4Sdns.has(sdnId)) {
        const sdnInfo = (v2Data?.responses || [])
          .flatMap(item => item.rulesDetails || [])
          .find(rule => rule.sdnid === sdnId);
        if (sdnInfo) {
          onlyInV2.push({
            id: sdnId,
            name: sdnInfo.sdnname || 'N/A',
            reference: sdnInfo.sanctionReferenceName || ''
          });
        }
      }
    });

    // Find SDNs in V4 but not in V2
    const onlyInV4 = [];
    v4Sdns.forEach(sdnId => {
      if (!v2Sdns.has(sdnId)) {
        const sdnInfo = (v4Data?.responses || [])
          .flatMap(item => item.rulesDetails || [])
          .find(rule => rule.sdnid === sdnId);
        if (sdnInfo) {
          onlyInV4.push({
            id: sdnId,
            name: sdnInfo.sdnname || 'N/A',
            reference: sdnInfo.sanctionReferenceName || ''
          });
        }
      }
    });

    return { onlyInV2, onlyInV4 };
  };

  // Helper function to split SDN list into chunks that fit within Excel's cell limit
  const splitSdnsForExport = (sdns) => {
    if (sdns.length === 0) return [{ content: 'No matches', isContinuation: false }];
    
    const MAX_CHUNK_SIZE = 30000; // Leave some buffer under 32,767 limit
    const result = [];
    let currentChunk = [];
    let currentLength = 0;
    
    for (const sdn of sdns) {
      const sdnText = `${sdn.id} - ${sdn.name}\n`;
      
      if (currentLength + sdnText.length > MAX_CHUNK_SIZE && currentChunk.length > 0) {
        result.push({
          content: currentChunk.join('').trim(),
          isContinuation: result.length > 0
        });
        currentChunk = [];
        currentLength = 0;
      }
      
      currentChunk.push(sdnText);
      currentLength += sdnText.length;
    }
    
    // Add the last chunk if not empty
    if (currentChunk.length > 0) {
      result.push({
        content: currentChunk.join('').trim(),
        isContinuation: result.length > 0
      });
    }
    
    return result;
  };

  const exportToExcel = async () => {
    if (results.length === 0) {
      showSnackbar('No data to export', 'warning');
      return;
    }

    try {
      // Show loading indicator
      const loadingSnackbar = showSnackbar('Preparing export...', 'info', 0);
      
      // Process data in chunks to avoid memory issues
      const CHUNK_SIZE = 100; // Smaller chunk size for better responsiveness
      const exportData = [];
      
      for (let i = 0; i < results.length; i += CHUNK_SIZE) {
        const chunk = results.slice(i, i + CHUNK_SIZE);
        
        // Process chunk
        for (const result of chunk) {
          // Get unique SDNs for V2 and V4
          const v2Sdns = result.v2?.responses?.length > 0
            ? result.v2.responses.map(item => ({
                id: item.rulesDetails?.sdnid || 'N/A',
                name: item.rulesDetails?.sdnname || 'N/A'
              }))
            : [];

          const v4Sdns = result.v4?.responses?.length > 0
            ? result.v4.responses.map(item => ({
                id: item.rulesDetails?.sdnid || 'N/A',
                name: item.rulesDetails?.sdnname || 'N/A'
              }))
            : [];

          // Find SDNs only in V2 or only in V4
          const onlyInV2 = v2Sdns.filter(v2 => 
            !v4Sdns.some(v4 => v4.id === v2.id)
          );
          
          const onlyInV4 = v4Sdns.filter(v4 => 
            !v2Sdns.some(v2 => v2.id === v4.id)
          );

          // Split SDN lists into chunks that fit within Excel's cell limit
          const v2Chunks = splitSdnsForExport(v2Sdns);
          const onlyV2Chunks = splitSdnsForExport(onlyInV2);
          const v4Chunks = splitSdnsForExport(v4Sdns);
          const onlyV4Chunks = splitSdnsForExport(onlyInV4);
          
          // Calculate which version is faster
          const v2Faster = result.v2?._duration && result.v4?._duration && 
                          result.v2._duration < result.v4._duration;
          const v4Faster = result.v2?._duration && result.v4?._duration && 
                          result.v4._duration < result.v2._duration;
          
          // Determine how many rows we'll need for this result
          const maxChunks = Math.max(
            v2Chunks.length,
            onlyV2Chunks.length,
            v4Chunks.length,
            onlyV4Chunks.length,
            1 // At least one row
          );
          
          // Create rows for this result
          for (let i = 0; i < maxChunks; i++) {
            const isFirstRow = i === 0;
            const rowData = {
              'Name': isFirstRow ? result.name : `(cont.) ${result.name}`,
              'V2 Duration (ms)': isFirstRow ? (result.v2?._duration ? result.v2._duration.toFixed(2) : 'N/A') : '',
              'V2 SDN Matches': v2Chunks[i]?.content || (isFirstRow ? 'No matches' : ''),
              'Only in V2': onlyV2Chunks[i]?.content || (isFirstRow ? 'No matches' : ''),
              'V4 Duration (ms)': isFirstRow ? (result.v4?._duration ? result.v4._duration.toFixed(2) : 'N/A') : '',
              'V4 SDN Matches': v4Chunks[i]?.content || (isFirstRow ? 'No matches' : ''),
              'Only in V4': onlyV4Chunks[i]?.content || (isFirstRow ? 'No matches' : ''),
              'V2 Faster?': isFirstRow ? (v2Faster ? '✓' : '') : '',
              'V4 Faster?': isFirstRow ? (v4Faster ? '✓' : '') : '',
              'Total Duration (ms)': isFirstRow ? (result._totalDuration ? result._totalDuration.toFixed(2) : 'N/A') : ''
            };
            
            exportData.push(rowData);
          }
        } // End of result processing
        
        // Update progress
        const progress = Math.min(100, Math.round(((i + chunk.length) / results.length) * 100));
        showSnackbar(`Processing... ${progress}%`, 'info', 0, loadingSnackbar);
        
        // Allow UI to update
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      // Create worksheet
      const ws = XLSX.utils.json_to_sheet(exportData);
      
      // Set column widths
      ws['!cols'] = [
        {wch: 30}, // Name
        {wch: 15}, // V2 Duration
        {wch: 40}, // V2 SDN Matches
        {wch: 40}, // Only in V2
        {wch: 15}, // V4 Duration
        {wch: 40}, // V4 SDN Matches
        {wch: 40}, // Only in V4
        {wch: 10}, // V2 Faster?
        {wch: 10}, // V4 Faster?
        {wch: 15}  // Total Duration
      ];
      
      // Create workbook and add worksheet
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Screening Results');
      
      // Add some styling to header row
      const range = XLSX.utils.decode_range(ws['!ref']);
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const cell = ws[XLSX.utils.encode_cell({r: 0, c: C})];
        if (cell) {
          cell.s = { 
            font: { bold: true },
            fill: { fgColor: { rgb: 'D3D3D3' } }
          };
        }
      }
      
      // Generate and save the Excel file
      showSnackbar('Generating Excel file...', 'info', 0, loadingSnackbar);
      
      // Use writeFile with options for better performance
      XLSX.writeFile(wb, `screening_results_${new Date().toISOString().slice(0, 10)}.xlsx`, {
        bookType: 'xlsx',
        type: 'array',
        compression: true
      });
      
      showSnackbar('Export successful!', 'success');
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      showSnackbar(`Export failed: ${error.message}`, 'error');
    }
  };

  const showSnackbar = (message, severity = 'info') => {
    setSnackbar({ open: true, message, severity });
  };

  const handleCloseSnackbar = () => {
    setSnackbar(prev => ({ ...prev, open: false }));
  };

  const handleTabChange = (event, newValue) => {
    setTabValue(newValue);
  };

  const renderResults = () => {
    if (results.length === 0) {
      return (
        <Box sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="body1" color="textSecondary">
            No results to display. Process a file to see the results.
          </Typography>
        </Box>
      );
    }

    const renderTable = (version = 'combined') => {
      // Define base headers
      const baseHeaders = [
        '#', 'Name', 'API Version', 'SDN ID', 'SDN Name', 'Duration', 
        'V2 Faster?', 'V4 Faster?'
      ];
      
      // For combined view, add additional columns
      const combinedHeaders = [
        ...baseHeaders.slice(0, -2), // Remove the last two columns (V2/V4 Faster?)
        'Only in V2', 
        'Only in V4',
        'V2 Faster?', 
        'V4 Faster?'
      ];
      
      // Use appropriate headers based on view
      const headers = version === 'combined' ? combinedHeaders : baseHeaders;

      const renderSdnDifferences = (sdns) => {
        if (!sdns?.length) return 'N/A';
        
        return (
          <Box>
            {sdns.map((sdn, i) => (
              <div key={`sdn-diff-${i}`}>
                <strong>{sdn.id}</strong>: {sdn.name}
                {sdn.reference && ` (${sdn.reference})`}
              </div>
            ))}
          </Box>
        );
      };

      return (
        <TableContainer component={Paper} sx={{ mt: 2, maxHeight: '70vh', overflow: 'auto' }}>
          <Table stickyHeader>
            <TableHead>
              <TableRow>
                {headers.map((header, idx) => (
                  <TableCell key={idx} style={{ fontWeight: 'bold' }}>{header}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {results.map((result, idx) => {
                const serialNumber = idx + 1;
                
                if (result.error) {
                  return (
                    <TableRow key={`error-${idx}`} style={{ backgroundColor: '#ffebee' }}>
                      <TableCell>{serialNumber}</TableCell>
                      <TableCell colSpan={headers.length - 1} align="center">
                        <Typography color="error">
                          {result.name}: {result.error}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  );
                }

                const renderVersionRows = (versionKey) => {
                  const versionData = result[versionKey];
                  if (!versionData) return null;

                  // If no matches, return a single row with 'No matches'
                  if (!versionData?.responses?.length) {
                    return (
                      <TableRow key={`${versionKey}-${idx}-no-match`}>
                        <TableCell>{serialNumber}</TableCell>
                        <TableCell>{result.name}</TableCell>
                        <TableCell>{versionKey.toUpperCase()}</TableCell>
                        <TableCell>No matches</TableCell>
                        <TableCell>N/A</TableCell>
                        <TableCell>
                          {versionData?._duration ? `${versionData._duration.toFixed(2)} ms` : 'N/A'}
                        </TableCell>
                        {version === 'combined' && result.v2?._duration && result.v4?._duration && (
                          <>
                            <TableCell 
                              style={{
                                backgroundColor: result.v2._duration < result.v4._duration ? 'rgba(0, 200, 0, 0.1)' : 'transparent',
                                color: result.v2._duration < result.v4._duration ? 'green' : 'inherit'
                              }}
                            >
                              {result.v2._duration < result.v4._duration ? '✓' : ''}
                            </TableCell>
                            <TableCell 
                              style={{
                                backgroundColor: result.v4._duration < result.v2._duration ? 'rgba(0, 200, 0, 0.1)' : 'transparent',
                                color: result.v4._duration < result.v2._duration ? 'green' : 'inherit'
                              }}
                            >
                              {result.v4._duration < result.v2._duration ? '✓' : ''}
                            </TableCell>
                          </>
                        )}
                        {version === 'combined' && (
                          <>
                            <TableCell>N/A</TableCell>
                            <TableCell>N/A</TableCell>
                          </>
                        )}
                      </TableRow>
                    );
                  }

                  // For each response, create a row with separate columns for ID and Name
                  return versionData.responses.map((item, i) => {
                    const sdnId = item.rulesDetails?.sdnid || 'N/A';
                    const sdnName = item.rulesDetails?.sdnname || 'N/A';
                    
                    return (
                      <TableRow key={`${versionKey}-${idx}-${i}`}>
                        {i === 0 ? (
                          <>
                            <TableCell rowSpan={versionData.responses.length}>
                              {serialNumber}
                            </TableCell>
                            <TableCell rowSpan={versionData.responses.length}>
                              {result.name}
                            </TableCell>
                            <TableCell rowSpan={versionData.responses.length}>
                              {versionKey.toUpperCase()}
                            </TableCell>
                          </>
                        ) : null}
                        <TableCell>{sdnId}</TableCell>
                        <TableCell>{sdnName}</TableCell>
                        {i === 0 && (
                          <>
                            <TableCell rowSpan={versionData.responses.length}>
                              {versionData?._duration ? `${versionData._duration.toFixed(2)} ms` : 'N/A'}
                            </TableCell>
                            {version === 'combined' && result.v2?._duration && result.v4?._duration && (
                              <>
                                <TableCell 
                                  rowSpan={versionData.responses.length}
                                  style={{
                                    backgroundColor: result.v2._duration < result.v4._duration ? 'rgba(0, 200, 0, 0.1)' : 'transparent',
                                    color: result.v2._duration < result.v4._duration ? 'green' : 'inherit'
                                  }}
                                >
                                  {result.v2._duration < result.v4._duration ? '✓' : ''}
                                </TableCell>
                                <TableCell 
                                  rowSpan={versionData.responses.length}
                                  style={{
                                    backgroundColor: result.v4._duration < result.v2._duration ? 'rgba(0, 200, 0, 0.1)' : 'transparent',
                                    color: result.v4._duration < result.v2._duration ? 'green' : 'inherit'
                                  }}
                                >
                                  {result.v4._duration < result.v2._duration ? '✓' : ''}
                                </TableCell>
                              </>
                            )}
                            {version === 'combined' && (
                              <>
                                <TableCell rowSpan={versionData.responses.length}>
                                  {renderSdnDifferences(result._sdnComparison?.onlyInV2)}
                                </TableCell>
                                <TableCell rowSpan={versionData.responses.length}>
                                  {renderSdnDifferences(result._sdnComparison?.onlyInV4)}
                                </TableCell>
                              </>
                            )}
                          </>
                        )}
                      </TableRow>
                    );
                  });
                };

                switch (version) {
                  case 'v2':
                    return renderVersionRows('v2');
                  case 'v4':
                    return renderVersionRows('v4');
                  default:
                    return (
                      <React.Fragment key={`combined-${idx}`}>
                        {result.v2 && renderVersionRows('v2')}
                        {result.v4 && renderVersionRows('v4')}
                      </React.Fragment>
                    );
                }
              })}
            </TableBody>
          </Table>
        </TableContainer>
      );
    };

    return (
      <Box sx={{ mt: 3 }}>
        <Tabs 
          value={tabValue} 
          onChange={handleTabChange} 
          indicatorColor="primary"
          textColor="primary"
          centered
        >
          <Tab label="Combined View" />
          <Tab label="V2 Results" />
          <Tab label="V4 Results" />
        </Tabs>
        
        {tabValue === 0 && renderTable('combined')}
        {tabValue === 1 && renderTable('v2')}
        {tabValue === 2 && renderTable('v4')}
      </Box>
    );
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        API Name Matcher
      </Typography>
      
      {initializing ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', my: 4 }}>
          <CircularProgress />
          <Typography variant="body1" sx={{ ml: 2 }}>
            Initializing authentication...
          </Typography>
        </Box>
      ) : (
        <Box sx={{ mb: 3, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <input
            accept=".xlsx, .xls"
            style={{ display: 'none' }}
            id="excel-file"
            type="file"
            onChange={handleFileChange}
          />
          <label htmlFor="excel-file">
            <Button
              variant="contained"
              component="span"
              startIcon={<UploadFileIcon />}
            >
              {file ? file.name : 'Select Excel File'}
            </Button>
          </label>
          
          <Button
            variant="contained"
            color="primary"
            onClick={handleProcessFile}
            disabled={!file || loading}
            startIcon={loading ? <CircularProgress size={20} /> : <PlayArrowIcon />}
          >
            {loading ? 'Processing...' : 'Process'}
          </Button>
          <Button
            variant="outlined"
            onClick={exportToExcel}
            disabled={results.length === 0 || loading}
          >
            Export to Excel
          </Button>
        </Box>
      )}
      
      {renderResults()}

      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert 
          onClose={handleCloseSnackbar} 
          severity={snackbar.severity} 
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Container>
  );
}

export default App;
