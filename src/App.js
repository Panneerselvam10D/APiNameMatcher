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
  Box,
  Tabs,
  Tab,
  Chip
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import * as XLSX from 'xlsx';
import apiService from './services/apiService';
import { Download, Settings } from '@mui/icons-material';
import { TextField, Dialog, DialogTitle, DialogContent, DialogActions, IconButton, Tooltip, Divider } from '@mui/material';
import axios from 'axios';

// Default configuration
const DEFAULT_CONFIG = {
  apiBaseUrl: 'https://screeningdevv2.ap.loclx.io',
  keycloakUrl: 'https://keycloak-auth.inside10d.com',
  keycloakRealm: 'ScreeningApp',
  keycloakClientId: 'screening-client',
  keycloakUsername: 'superuser',
  keycloakPassword: 'superuser',
  apiEndpointV1: 'v1.2',
  apiEndpointV2: 'v2'
};

function App() {
  const [file, setFile] = useState(null);
  const [results, setResults] = useState([]);
  const [onlyInResults, setOnlyInResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('combined');
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [config, setConfig] = useState(() => {
    // Load saved config from localStorage or use defaults
    const savedConfig = localStorage.getItem('appConfig');
    return savedConfig ? JSON.parse(savedConfig) : DEFAULT_CONFIG;
  });
  const [initializing, setInitializing] = useState(true);

  // Save config to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('appConfig', JSON.stringify(config));
    // Update API service with new config
    apiService.updateConfig({
      apiBaseUrl: config.apiBaseUrl,
      keycloakConfig: {
        url: config.keycloakUrl,
        realm: config.keycloakRealm,
        clientId: config.keycloakClientId,
        username: config.keycloakUsername,
        password: config.keycloakPassword
      },
      apiEndpoints: {
        v1_2: config.apiEndpointV1,
        v2: config.apiEndpointV2
      }
    });
  }, [config]);

  useEffect(() => {
    // Initialize by getting the first access token
    const initializeAuth = async () => {
      try {
        console.log('Initializing authentication...');
        const token = await apiService.getAccessToken();
        console.log('Successfully obtained access token');
        setInitializing(false);
      } catch (error) {
        console.error('Initialization error:', error);
        let errorMessage = error.message || 'Failed to initialize authentication';
        
        // Extract more detailed error message if available
        if (error.originalError?.response?.data?.error_description) {
          errorMessage = error.originalError.response.data.error_description;
        } else if (error.originalError?.message) {
          errorMessage = error.originalError.message;
        }
        
        setSnackbar({
          open: true,
          message: `Authentication Error: ${errorMessage}`,
          severity: 'error'
        });
        
        // Open settings if this is the first initialization
        if (initializing) {
          setSettingsOpen(true);
        }
        
        setInitializing(false);
      }
    };

    initializeAuth();
  }, [initializing]);

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
          
          // Compare SDN data between V2, V4, and Univius
          const sdnComparison = compareSdnData(result.v2, result.v4, result.univius);
          
          // Update results with the new data
          setResults(prevResults => [
            ...prevResults,
            {
              name,
              v2: result.v2,
              v4: result.v4,
              univius: result.univius,
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

  // Helper function to extract SDNs from univius API response
  const extractUniviusSdns = (univiusData) => {
    if (!univiusData || !Array.isArray(univiusData)) return [];
    
    return univiusData.map(item => ({
      id: item.sdnId || 'N/A',
      name: item.sdnName || 'N/A',
      reference: item.listName || ''
    }));
  };

  // Helper function to compare SDN data between V2, V4, and Univius
  const compareSdnData = (v2Data, v4Data, univiusData) => {
    // Extract unique SDN IDs from V2, V4, and Univius
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
    
    const univiusSdns = new Set(
      (Array.isArray(univiusData) ? univiusData : [])
        .map(item => item.sdnId)
        .filter(Boolean)
    );

    // Helper function to find SDN info in V2/V4 responses
    const findSdnInfo = (data, sdnId) => {
      return (data?.responses || [])
        .flatMap(item => item.rulesDetails || [])
        .find(rule => rule.sdnid === sdnId);
    };

    // Find SDNs in V2 but not in V4 or Univius
    const onlyInV2 = [];
    v2Sdns.forEach(sdnId => {
      if (!v4Sdns.has(sdnId) && !univiusSdns.has(sdnId)) {
        const sdnInfo = findSdnInfo(v2Data, sdnId);
        if (sdnInfo) {
          onlyInV2.push({
            id: sdnId,
            name: sdnInfo.sdnname || 'N/A',
            reference: sdnInfo.sanctionReferenceName || ''
          });
        }
      }
    });

    // Find SDNs in V4 but not in V2 or Univius
    const onlyInV4 = [];
    v4Sdns.forEach(sdnId => {
      if (!v2Sdns.has(sdnId) && !univiusSdns.has(sdnId)) {
        const sdnInfo = findSdnInfo(v4Data, sdnId);
        if (sdnInfo) {
          onlyInV4.push({
            id: sdnId,
            name: sdnInfo.sdnname || 'N/A',
            reference: sdnInfo.sanctionReferenceName || ''
          });
        }
      }
    });
    
    // Find SDNs in Univius but not in V2 or V4
    const onlyInUnivius = [];
    univiusSdns.forEach(sdnId => {
      if (!v2Sdns.has(sdnId) && !v4Sdns.has(sdnId)) {
        const sdnInfo = (Array.isArray(univiusData) ? univiusData : []).find(item => item.sdnId === sdnId);
        if (sdnInfo) {
          onlyInUnivius.push({
            id: sdnId,
            name: sdnInfo.sdnName || 'N/A',
            reference: sdnInfo.listName || ''
          });
        }
      }
    });

    return { onlyInV2, onlyInV4, onlyInUnivius };
  };

  // Helper function to split SDN list into chunks that fit within Excel's cell limit
  const splitSdnsForExport = (sdns) => {
    if (sdns.length === 0) return [{ content: 'No matches', isContinuation: false }];
    
    const MAX_CHUNK_SIZE = 30000; // Leave some buffer under 32,767 limit
    const result = [];
    let currentChunk = [];
    let currentLength = 0;
    
    for (const sdn of sdns) {
      // Use Excel-compatible line break (\r\n) and ensure each SDN is on its own line
      const sdnText = `${sdn.id} - ${sdn.name}\r\n`;
      
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

  const exportOnlyInToExcel = async () => {
    if (onlyInResults.length === 0) {
      showSnackbar('No "Only in V2/V4" data to export', 'warning');
      return;
    }
    
    try {
      const loadingSnackbar = showSnackbar('Preparing export...', 'info', 0);
      
      // Prepare data for export
      const exportData = [];
      let rowIndex = 1; // Start serial number from 1
      
      onlyInResults.forEach((result, idx) => {
        const v2Sdns = result.v2?.responses?.length > 0 ? result.v2.responses : [];
        const v4Sdns = result.v4?.responses?.length > 0 ? result.v4.responses : [];
        
        // Find SDNs only in V2 or only in V4
        const onlyInV2 = v2Sdns.filter(v2 => 
          !v4Sdns.some(v4 => v4.rulesDetails?.sdnid === v2.rulesDetails?.sdnid)
        );
        
        const onlyInV4 = v4Sdns.filter(v4 => 
          !v2Sdns.some(v2 => v2.rulesDetails?.sdnid === v4.rulesDetails?.sdnid)
        );
        
        // Format SDNs for export - one row per SDN
        const maxRows = Math.max(onlyInV2.length, onlyInV4.length);
        
        for (let i = 0; i < maxRows; i++) {
          const v2Sdn = onlyInV2[i]?.rulesDetails;
          const v4Sdn = onlyInV4[i]?.rulesDetails;
          
          const v2Text = v2Sdn ? 
            `${v2Sdn.sdnid || 'N/A'} - ${v2Sdn.sdnname || 'N/A'}` : '';
          
          const v4Text = v4Sdn ? 
            `${v4Sdn.sdnid || 'N/A'} - ${v4Sdn.sdnname || 'N/A'}` : '';
          
          const rowData = {
            'Name': i === 0 ? result.name : '',
            'Only in V2': v2Text,
            'Only in V4': v4Text
          };
          
          exportData.push(rowData);
        }
        
        if (maxRows > 0) {
          rowIndex++; // Increment serial number for the next name
        }
      });
      
      // Create worksheet
      const ws = XLSX.utils.json_to_sheet(exportData);
      
      // Set column widths
      ws['!cols'] = [
        { wch: 30 }, // Name
        { wch: 60 }, // Only in V2
        { wch: 60 }  // Only in V4
      ];
      
      // Create workbook and add worksheet
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Only in V2-V4 Results');
      
      // Generate and save the Excel file
      XLSX.writeFile(wb, `only_in_v2_v4_results_${new Date().toISOString().slice(0, 10)}.xlsx`);
      
      showSnackbar('Export successful!', 'success');
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      showSnackbar(`Export failed: ${error.message}`, 'error');
    }
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
          // Get unique SDNs for V2, V4, and Univius
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
            
          const univiusSdns = Array.isArray(result.univius)
            ? result.univius.map(item => ({
                id: item.sdnId || 'N/A',
                name: item.sdnName || 'N/A',
                reference: item.listName || ''
              }))
            : [];

          // Find SDNs only in each API
          const onlyInV2 = v2Sdns.filter(v2 => 
            !v4Sdns.some(v4 => v4.id === v2.id) &&
            !univiusSdns.some(u => u.id === v2.id)
          );
          
          const onlyInV4 = v4Sdns.filter(v4 => 
            !v2Sdns.some(v2 => v2.id === v4.id) &&
            !univiusSdns.some(u => u.id === v4.id)
          );
          
          const onlyInUnivius = univiusSdns.filter(u => 
            !v2Sdns.some(v2 => v2.id === u.id) &&
            !v4Sdns.some(v4 => v4.id === u.id)
          );

          // Split SDN lists into chunks that fit within Excel's cell limit
          const v2Chunks = splitSdnsForExport(v2Sdns);
          const onlyV2Chunks = splitSdnsForExport(onlyInV2);
          const v4Chunks = splitSdnsForExport(v4Sdns);
          const onlyV4Chunks = splitSdnsForExport(onlyInV4);
          const univiusChunks = splitSdnsForExport(univiusSdns);
          const onlyUniviusChunks = splitSdnsForExport(onlyInUnivius);
          
          // Calculate which version is faster
          const durations = {
            v2: result.v2?._duration || 0,
            v4: result.v4?._duration || 0,
            univius: result.univius?._duration || 0
          };
          
          const fastestApi = Object.entries(durations).reduce((a, b) => 
            a[1] > 0 && (a[1] < b[1] || b[1] === 0) ? a : b, ['', Infinity])[0];
          
          // Determine how many rows we'll need for this result
          const maxChunks = Math.max(
            v2Chunks.length,
            onlyV2Chunks.length,
            v4Chunks.length,
            onlyV4Chunks.length,
            univiusChunks.length,
            onlyUniviusChunks.length,
            1 // At least one row
          );
          
          // Create rows for this result
          for (let i = 0; i < maxChunks; i++) {
            const isFirstRow = i === 0;
            const rowData = {
              'Name': isFirstRow ? result.name : `(cont.) ${result.name}`,
              
              // V2 Data
              'V2 Duration (ms)': isFirstRow ? (durations.v2 ? durations.v2.toFixed(2) : 'N/A') : '',
              'V2 SDN Matches': v2Chunks[i]?.content || (isFirstRow ? 'No matches' : ''),
              'Only in V2': onlyV2Chunks[i]?.content || (isFirstRow ? 'No matches' : ''),
              
              // V4 Data
              'V4 Duration (ms)': isFirstRow ? (durations.v4 ? durations.v4.toFixed(2) : 'N/A') : '',
              'V4 SDN Matches': v4Chunks[i]?.content || (isFirstRow ? 'No matches' : ''),
              'Only in V4': onlyV4Chunks[i]?.content || (isFirstRow ? 'No matches' : ''),
              
              // Univius Data
              'Univius Duration (ms)': isFirstRow ? (durations.univius ? durations.univius.toFixed(2) : 'N/A') : '',
              'Univius SDN Matches': univiusChunks[i]?.content || (isFirstRow ? 'No matches' : ''),
              'Only in Univius': onlyUniviusChunks[i]?.content || (isFirstRow ? 'No matches' : ''),
              
              // Comparison
              'Fastest API': isFirstRow ? 
                (fastestApi === 'v2' ? 'V2' : 
                 fastestApi === 'v4' ? 'V4' : 
                 fastestApi === 'univius' ? 'Univius' : 'N/A') : '',
              
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
      
      // Set initial column widths
      ws['!cols'] = [
        {wch: 30}, // Name
        
        // V2 Columns
        {wch: 15}, // V2 Duration
        {wch: 40}, // V2 SDN Matches
        {wch: 40}, // Only in V2
        
        // V4 Columns
        {wch: 15}, // V4 Duration
        {wch: 40}, // V4 SDN Matches
        {wch: 40}, // Only in V4
        
        // Univius Columns
        {wch: 15}, // Univius Duration
        {wch: 40}, // Univius SDN Matches
        {wch: 40}, // Only in Univius
        
        // Comparison Columns
        {wch: 15}, // Fastest API
        {wch: 15}  // Total Duration
      ];
      
      // Create workbook and add worksheet
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Screening Results');
      
      // Add styling to all cells
      const range = XLSX.utils.decode_range(ws['!ref']);
      
      // Style header row
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const cell = ws[XLSX.utils.encode_cell({r: 0, c: C})];
        if (cell) {
          cell.s = { 
            font: { bold: true },
            fill: { fgColor: { rgb: 'D3D3D3' } },
            alignment: { 
              wrapText: true, 
              vertical: 'top',
              horizontal: 'center'
            },
            border: {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            }
          };
        }
      }
      
      // Style data rows with wrap text and borders
      for (let R = range.s.r + 1; R <= range.e.r; ++R) {
        // Set row height to auto
        if (!ws['!rows']) ws['!rows'] = [];
        ws['!rows'][R] = { hpx: 'auto', hpt: 'auto' };
        
        for (let C = range.s.c; C <= range.e.c; ++C) {
          const cell = ws[XLSX.utils.encode_cell({r: R, c: C})];
          if (cell) {
            // Preserve existing styles if any
            const existingStyle = cell.s || {};
            cell.s = {
              ...existingStyle,
              alignment: { 
                wrapText: true, 
                vertical: 'top',
                ...(existingStyle.alignment || {})
              },
              border: {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' },
                ...(existingStyle.border || {})
              }
            };
          }
        }
      }
      
      // Set explicit column widths for better readability
      ws['!cols'] = [
        { wch: 30 }, // Name
        
        // V2 Columns
        { wch: 15 },  // V2 Duration
        { wch: 50 },  // V2 SDN Matches
        { wch: 50 },  // Only in V2
        
        // V4 Columns
        { wch: 15 },  // V4 Duration
        { wch: 50 },  // V4 SDN Matches
        { wch: 50 },  // Only in V4
        
        // Univius Columns
        { wch: 15 },  // Univius Duration
        { wch: 50 },  // Univius SDN Matches
        { wch: 50 },  // Only in Univius
        
        // Comparison Columns
        { wch: 15 },  // Fastest API
        { wch: 18 }   // Total Duration
      ];
      
      // Add some visual separation between API sections
      const headerRow = ws[XLSX.utils.encode_cell({r: 0, c: 0})];
      if (headerRow) {
        headerRow.s = {
          ...headerRow.s,
          fill: { fgColor: { rgb: 'E6E6E6' } },
          font: { bold: true, color: { rgb: '333333' } }
        };
      }
      
      // Style the duration columns for better readability
      const durationColumns = [1, 4, 7]; // Indices of duration columns
      for (let R = range.s.r + 1; R <= range.e.r; ++R) {
        durationColumns.forEach(col => {
          const cell = ws[XLSX.utils.encode_cell({r: R, c: col})];
          if (cell) {
            cell.s = {
              ...cell.s,
              numFmt: '0.00',
              alignment: { ...(cell.s?.alignment || {}), horizontal: 'right' }
            };
          }
        });
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
    setActiveTab(newValue);
    
    // When switching to only-in tab, prepare the data
    if (newValue === 'onlyIn') {
      const onlyInData = results.filter(result => {
        const v2Sdns = result.v2?.responses?.length > 0 ? result.v2.responses : [];
        const v4Sdns = result.v4?.responses?.length > 0 ? result.v4.responses : [];
        
        // Find SDNs only in V2 or only in V4
        const onlyInV2 = v2Sdns.filter(v2 => 
          !v4Sdns.some(v4 => v4.rulesDetails?.sdnid === v2.rulesDetails?.sdnid)
        );
        
        const onlyInV4 = v4Sdns.filter(v4 => 
          !v2Sdns.some(v2 => v2.rulesDetails?.sdnid === v4.rulesDetails?.sdnid)
        );
        
        return onlyInV2.length > 0 || onlyInV4.length > 0;
      });
      
      setOnlyInResults(onlyInData);
    }
  };

  // Helper function to render SDN list
  const renderSdnList = (sdns, isUnivius = false) => {
    if (!sdns || sdns.length === 0) {
      return <Typography color="textSecondary">No matches</Typography>;
    }

    return (
      <Box sx={{ maxHeight: '200px', overflowY: 'auto' }}>
        {sdns.map((sdn, index) => (
          <Box key={index} sx={{ mb: 1, p: 1, bgcolor: 'background.paper', borderRadius: 1 }}>
            <Typography variant="body2">
              <strong>ID:</strong> {sdn.id}<br />
              <strong>Name:</strong> {sdn.name}<br />
              {sdn.reference && (
                <>
                  <strong>Reference:</strong> {sdn.reference}
                </>
              )}
            </Typography>
          </Box>
        ))}
      </Box>
    );
  };

  // Helper function to render API result card
  const renderApiResultCard = (title, data, durationKey, isLoading = false) => {
    if (isLoading) {
      return (
        <Paper sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
          <Typography variant="h6" gutterBottom>{title}</Typography>
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
            <CircularProgress size={24} />
          </Box>
        </Paper>
      );
    }

    const duration = data?.[durationKey];
    const sdns = Array.isArray(data) ? data : [];
    
    return (
      <Paper sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6">{title}</Typography>
          {duration && (
            <Chip 
              label={`${duration.toFixed(2)} ms`} 
              color="primary" 
              size="small"
              sx={{ fontWeight: 'bold' }}
            />
          )}
        </Box>
        {renderSdnList(sdns, title === 'Univius')}
      </Paper>
    );
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
        'V2 Faster?', 
        'V4 Faster?',
        'Only in V2', 
        'Only in V4',
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
                                color: result.v4._duration < result.v4._duration ? 'green' : 'inherit'
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
          value={activeTab}
          onChange={handleTabChange}
          indicatorColor="primary"
          textColor="primary"
          variant="fullWidth"
          aria-label="results tabs"
        >
          <Tab value="combined" label="Combined Results" />
          <Tab 
            value="onlyIn" 
            label="Only in V2/V4" 
            disabled={results.length === 0}
          />
        </Tabs>
        
        {activeTab === 'combined' && renderTable('combined')}
        {activeTab === 'onlyIn' && (
          <TableContainer component={Paper} sx={{ mt: 2, maxHeight: '70vh', overflow: 'auto' }}>
            <Table stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell style={{ fontWeight: 'bold', width: '80px' }}>S.No.</TableCell>
                  <TableCell style={{ fontWeight: 'bold' }}>Name</TableCell>
                  <TableCell style={{ fontWeight: 'bold' }}>Only in V2</TableCell>
                  <TableCell style={{ fontWeight: 'bold' }}>Only in V4</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {onlyInResults.map((result, idx) => {
                  const serialNumber = idx + 1;
                  
                  if (result.error) {
                    return (
                      <TableRow key={`error-${idx}`} style={{ backgroundColor: '#ffebee' }}>
                        <TableCell>{serialNumber}</TableCell>
                        <TableCell colSpan={2} align="center">
                          <Typography color="error">
                            {result.name}: {result.error}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    );
                  }

                  const v2Sdns = result.v2?.responses?.length > 0 ? result.v2.responses : [];
                  const v4Sdns = result.v4?.responses?.length > 0 ? result.v4.responses : [];

                  // Find SDNs only in V2 or only in V4
                  const onlyInV2 = v2Sdns.filter(v2 => 
                    !v4Sdns.some(v4 => v4.rulesDetails?.sdnid === v2.rulesDetails?.sdnid)
                  );
                  
                  const onlyInV4 = v4Sdns.filter(v4 => 
                    !v2Sdns.some(v2 => v2.rulesDetails?.sdnid === v4.rulesDetails?.sdnid)
                  );

                  return (
                    <TableRow key={idx}>
                      <TableCell>{idx + 1}</TableCell>
                      <TableCell>{result.name}</TableCell>
                      <TableCell>
                        {onlyInV2.map((sdn, i) => {
                          const sdnId = sdn.rulesDetails?.sdnid || 'N/A';
                          const sdnName = sdn.rulesDetails?.sdnname || 'N/A';
                          return (
                            <div key={`sdn-v2-${i}`} style={{ marginBottom: '4px' }}>
                              <strong>{i + 1}. {sdnId}</strong>: {sdnName}
                            </div>
                          );
                        })}
                        {onlyInV2.length === 0 && <div>-</div>}
                      </TableCell>
                      <TableCell>
                        {onlyInV4.map((sdn, i) => {
                          const sdnId = sdn.rulesDetails?.sdnid || 'N/A';
                          const sdnName = sdn.rulesDetails?.sdnname || 'N/A';
                          return (
                            <div key={`sdn-v4-${i}`} style={{ marginBottom: '4px' }}>
                              <strong>{i + 1}. {sdnId}</strong>: {sdnName}
                            </div>
                          );
                        })}
                        {onlyInV4.length === 0 && <div>-</div>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Box>
    );
  };

  const handleSettingsOpen = () => setSettingsOpen(true);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState(null);

  const handleSettingsClose = () => {
    setSettingsOpen(false);
    setConnectionStatus(null);
  };

  const handleConfigChange = (field, value) => {
    setConfig(prev => ({
      ...prev,
      [field]: value
    }));
    setConnectionStatus(null); // Reset status when config changes
  };

  const testKeycloakConnection = async () => {
    setIsTestingConnection(true);
    setConnectionStatus(null);
    
    try {
      // Create a temporary config with current form values
      const tempConfig = {
        ...config,
        keycloakConfig: {
          url: config.keycloakUrl,
          realm: config.keycloakRealm,
          clientId: config.keycloakClientId,
          username: config.keycloakUsername,
          password: config.keycloakPassword
        }
      };
      
      // Test the connection
      const testApi = axios.create({
        baseURL: config.apiBaseUrl,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 10000 // 10 second timeout for testing
      });
      
      const params = new URLSearchParams();
      params.append('client_id', tempConfig.keycloakConfig.clientId);
      params.append('username', tempConfig.keycloakConfig.username);
      params.append('password', tempConfig.keycloakConfig.password);
      params.append('grant_type', 'password');
      
      const tokenUrl = `${tempConfig.keycloakConfig.url}/realms/${tempConfig.keycloakConfig.realm}/protocol/openid-connect/token`;
      
      const response = await testApi.post(tokenUrl, params);
      
      if (response.data?.access_token) {
        setConnectionStatus({ type: 'success', message: 'Successfully connected to Keycloak!' });
      } else {
        setConnectionStatus({ type: 'error', message: 'Connection successful but no token received' });
      }
    } catch (error) {
      console.error('Connection test failed:', error);
      let message = error.message;
      
      if (error.response) {
        if (error.response.status === 401) {
          message = 'Invalid credentials';
        } else if (error.response.status === 404) {
          message = 'Keycloak endpoint not found. Check the URL and realm.';
        } else {
          message = `Server error: ${error.response.status} ${error.response.statusText}`;
        }
      } else if (error.code === 'ECONNABORTED') {
        message = 'Connection timed out. Check the server URL and your network connection.';
      } else if (error.request) {
        message = 'No response from server. Check the URL and ensure the server is running.';
      }
      
      setConnectionStatus({ type: 'error', message });
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleResetSettings = () => {
    if (window.confirm('Are you sure you want to reset all settings to default?')) {
      setConfig(DEFAULT_CONFIG);
    }
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
        <Typography variant="h4" component="h1" gutterBottom>
          API Matcher
        </Typography>
        <Tooltip title="Settings">
          <IconButton onClick={handleSettingsOpen} color="primary">
            <Settings />
          </IconButton>
        </Tooltip>
      </Box>

      {initializing ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', my: 4 }}>
          <CircularProgress />
          <Typography variant="body1" sx={{ ml: 2 }}>
            Initializing...
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
          
          <Box sx={{ mt: 2, display: 'flex', gap: 2, width: '100%' }}>
            <Button
              variant="contained"
              color="primary"
              onClick={exportToExcel}
              disabled={results.length === 0}
              startIcon={<Download />}
            >
              Export All to Excel
            </Button>
            
            <Button
              variant="outlined"
              color="primary"
              onClick={exportOnlyInToExcel}
              disabled={onlyInResults.length === 0}
              startIcon={<Download />}
            >
              Export Only in V2/V4/Univius
            </Button>
          </Box>
          
          {/* Render the results table */}
          {results.length > 0 && (
            <Box sx={{ width: '100%', mt: 3 }}>
              {renderResults()}
            </Box>
          )}
        </Box>
      )}

      {/* Settings Dialog */}
      <Dialog open={settingsOpen} onClose={handleSettingsClose} maxWidth="md" fullWidth>
        <DialogTitle>Application Settings</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2, display: 'grid', gap: 2, gridTemplateColumns: '1fr 1fr' }}>
            <Typography variant="h6" sx={{ gridColumn: '1 / -1', mt: 1 }}>API Configuration</Typography>
            <TextField
              label="API Base URL"
              value={config.apiBaseUrl}
              onChange={(e) => handleConfigChange('apiBaseUrl', e.target.value)}
              fullWidth
              size="small"
            />
            <TextField
              label="API Endpoint V1.2"
              value={config.apiEndpointV1}
              onChange={(e) => handleConfigChange('apiEndpointV1', e.target.value)}
              fullWidth
              size="small"
            />
            <TextField
              label="API Endpoint V2"
              value={config.apiEndpointV2}
              onChange={(e) => handleConfigChange('apiEndpointV2', e.target.value)}
              fullWidth
              size="small"
            />

            <Divider sx={{ gridColumn: '1 / -1', my: 1 }} />
            <Typography variant="h6" sx={{ gridColumn: '1 / -1' }}>Keycloak Configuration</Typography>
            
            <TextField
              label="Keycloak URL"
              value={config.keycloakUrl}
              onChange={(e) => handleConfigChange('keycloakUrl', e.target.value)}
              fullWidth
              size="small"
              disabled={isTestingConnection}
            />
            <TextField
              label="Realm"
              value={config.keycloakRealm}
              onChange={(e) => handleConfigChange('keycloakRealm', e.target.value)}
              fullWidth
              size="small"
              disabled={isTestingConnection}
            />
            <TextField
              label="Client ID"
              value={config.keycloakClientId}
              onChange={(e) => handleConfigChange('keycloakClientId', e.target.value)}
              fullWidth
              size="small"
              disabled={isTestingConnection}
            />
            <TextField
              label="Username"
              value={config.keycloakUsername}
              onChange={(e) => handleConfigChange('keycloakUsername', e.target.value)}
              fullWidth
              size="small"
              disabled={isTestingConnection}
            />
            <TextField
              label="Password"
              type="password"
              value={config.keycloakPassword}
              onChange={(e) => handleConfigChange('keycloakPassword', e.target.value)}
              fullWidth
              size="small"
              disabled={isTestingConnection}
            />

            {connectionStatus && (
              <Box sx={{ 
                gridColumn: '1 / -1',
                p: 2,
                borderRadius: 1,
                bgcolor: connectionStatus.type === 'success' ? 'success.light' : 'error.light',
                color: 'white'
              }}>
                {connectionStatus.message}
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button 
            onClick={testKeycloakConnection} 
            color="primary"
            variant="outlined"
            disabled={isTestingConnection}
            startIcon={isTestingConnection ? <CircularProgress size={20} /> : null}
          >
            {isTestingConnection ? 'Testing...' : 'Test Connection'}
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button 
            onClick={handleResetSettings} 
            color="error"
            disabled={isTestingConnection}
          >
            Reset to Defaults
          </Button>
          <Button 
            onClick={handleSettingsClose} 
            color="primary"
            variant="contained"
            disabled={isTestingConnection}
          >
            Save & Close
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}

export default App;
