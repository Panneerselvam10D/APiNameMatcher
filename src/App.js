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

  const exportToExcel = () => {
    if (results.length === 0) {
      showSnackbar('No data to export', 'warning');
      return;
    }

    try {
      const exportData = results.map(result => {
        // Format V2 SDN data
        const v2Sdns = result.v2?.responses?.length > 0
          ? result.v2.responses.map(item => ({
              id: item.rulesDetails?.sdnid || 'N/A',
              name: item.rulesDetails?.sdnname || 'N/A',
              match: item.nameMatchPercentage || 'N/A',
              reference: item.rulesDetails?.sanctionReferenceName || 'N/A'
            }))
          : [];

        // Format V4 SDN data
        const v4Sdns = result.v4?.responses?.length > 0
          ? result.v4.responses.map(item => ({
              id: item.rulesDetails?.sdnid || 'N/A',
              name: item.rulesDetails?.sdnname || 'N/A',
              match: item.nameMatchPercentage || 'N/A',
              reference: item.rulesDetails?.sanctionReferenceName || 'N/A'
            }))
          : [];

        // Format SDN lists for display
        const formatSdns = (sdns) => {
          if (sdns.length === 0) return 'No matches';
          return sdns.map(s => `ID: ${s.id} - ${s.name} (${s.match}%)`).join('\n');
        };

        return {
          'Name': result.name,
          'V2 Duration (ms)': result.v2?._duration ? result.v2._duration.toFixed(2) : 'N/A',
          'V2 SDN Matches': formatSdns(v2Sdns),
          'V4 Duration (ms)': result.v4?._duration ? result.v4._duration.toFixed(2) : 'N/A',
          'V4 SDN Matches': formatSdns(v4Sdns),
          'Total Duration (ms)': result._totalDuration ? result._totalDuration.toFixed(2) : 'N/A'
        };
      });

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Screening Results');
      
      // Auto-size columns
      const wscols = [
        {wch: 30}, // Name
        {wch: 15}, // V2 Duration
        {wch: 60}, // V2 SDN Matches
        {wch: 15}, // V4 Duration
        {wch: 60}, // V4 SDN Matches
        {wch: 15}  // Total Duration
      ];
      ws['!cols'] = wscols;
      
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
      
      const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const data = new Blob([excelBuffer], { type: 'application/octet-stream' });
      saveAs(data, `screening-results-${new Date().toISOString().split('T')[0]}.xlsx`);
      
      showSnackbar('Exported to Excel successfully!', 'success');
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      showSnackbar('Failed to export to Excel', 'error');
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
      const headers = [
        '#', 'Name', 'API Version', 'SDN ID', 'SDN Name', 'Match %', 'Duration'
      ];
      
      if (version === 'combined') {
        headers.push('Only in V2', 'Only in V4');
      }

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
                        <TableCell colSpan={2}>No matches</TableCell>
                        <TableCell>N/A</TableCell>
                        <TableCell>
                          {versionData?._duration ? `${versionData._duration.toFixed(2)} ms` : 'N/A'}
                        </TableCell>
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
                        {i === 0 ? (
                          <>
                            <TableCell rowSpan={versionData.responses.length}>
                              {item.nameMatchPercentage || 'N/A'}
                            </TableCell>
                            <TableCell rowSpan={versionData.responses.length}>
                              {versionData?._duration ? `${versionData._duration.toFixed(2)} ms` : 'N/A'}
                            </TableCell>
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
                        ) : null}
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
