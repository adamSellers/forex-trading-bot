// frontend/src/components/SystemLogs.jsx - FIXED FILTERING
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Paper,
  Typography,
  Box,
  ToggleButtonGroup,
  ToggleButton,
  Button,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  CircularProgress,
  Alert,
  Chip
} from '@mui/material';
import { Refresh as RefreshIcon, ExpandMore, BugReport, Info, Warning, Error as ErrorIcon, CheckCircle } from '@mui/icons-material';
import { managementAPI } from '../config/api';

const LogViewer = () => {
  const [logs, setLogs] = useState([]);
  const [logLevelFilter, setLogLevelFilter] = useState('info'); // Default view
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // 1. Fetch Logs (Get maximum detail 'debug' from server to ensure we have data to filter)
  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      // We request 'debug' to get ALL recent logs, then filter locally
      const response = await managementAPI.getLogs({ level: 'debug', limit: 200 });
      
      let parsedLogs = [];
      if (Array.isArray(response)) {
          parsedLogs = response;
      } else if (response?.logs && Array.isArray(response.logs)) {
          parsedLogs = response.logs;
      } else if (response?.data && Array.isArray(response.data)) {
          parsedLogs = response.data;
      }

      setLogs(parsedLogs);
    } catch (err) {
      console.error("Log Fetch Error:", err);
      setError(`Failed to load logs: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []); // Only fetch once on mount/refresh

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // 2. Define Log Levels Hierarchy
  const LOG_LEVELS = {
    debug: 0,
    info: 1,
    success: 1, // Treat success same as info priority
    warn: 2,
    error: 3
  };

  // 3. Client-Side Filtering (Robust)
  const filteredLogs = useMemo(() => {
    if (!logs.length) return [];
    
    const minPriority = LOG_LEVELS[logLevelFilter] || 0;
    
    return logs.filter(log => {
        const level = (log.level || 'info').toLowerCase();
        const priority = LOG_LEVELS[level] !== undefined ? LOG_LEVELS[level] : 1;
        return priority >= minPriority;
    });
  }, [logs, logLevelFilter]);

  const getLogConfig = (level) => {
    const normalized = (level || 'info').toLowerCase();
    switch (normalized) {
      case 'error': return { color: 'error.main', icon: <ErrorIcon fontSize="small" /> };
      case 'warn': return { color: 'warning.main', icon: <Warning fontSize="small" /> };
      case 'success': return { color: 'success.main', icon: <CheckCircle fontSize="small" /> };
      case 'debug': return { color: 'text.secondary', icon: <BugReport fontSize="small" /> };
      default: return { color: 'info.main', icon: <Info fontSize="small" /> };
    }
  };

  return (
    <Paper sx={{ p: 3, width: '100%', boxSizing: 'border-box', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h5">System Logs</Typography>
        <Box display="flex" gap={2} alignItems="center">
          <ToggleButtonGroup
            value={logLevelFilter}
            exclusive
            onChange={(e, newLevel) => newLevel && setLogLevelFilter(newLevel)}
            size="small"
          >
            <ToggleButton value="debug">Debug</ToggleButton>
            <ToggleButton value="info">Info</ToggleButton>
            <ToggleButton value="warn">Warn</ToggleButton>
            <ToggleButton value="error">Error</ToggleButton>
          </ToggleButtonGroup>
          <Button variant="outlined" size="small" startIcon={<RefreshIcon />} onClick={fetchLogs} disabled={loading}>
            Refresh
          </Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Box sx={{ 
          flexGrow: 1, 
          overflowY: 'auto', 
          p: 2, 
          backgroundColor: 'action.hover', 
          borderRadius: 1, 
          border: '1px solid', 
          borderColor: 'divider' 
      }}>
        {loading ? (
          <Box display="flex" justifyContent="center" alignItems="center" height="100%">
            <CircularProgress size={30} />
            <Typography sx={{ ml: 2 }}>Loading Logs...</Typography>
          </Box>
        ) : filteredLogs.length > 0 ? (
          filteredLogs.map((log, index) => {
             const config = getLogConfig(log.level);
             const hasData = log.data && Object.keys(log.data).length > 0;
             const timestamp = log.timestamp || log.time || new Date().toISOString();
             
             return (
                <Box key={index} sx={{ mb: 1, borderBottom: '1px solid', borderColor: 'divider', pb: 1 }}>
                  <Box display="flex" alignItems="center" gap={1} mb={0.5}>
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>
                        {new Date(timestamp).toLocaleTimeString()}
                    </Typography>
                    <Chip 
                        label={(log.level || 'INFO').toUpperCase()} 
                        size="small" 
                        icon={config.icon}
                        sx={{ 
                            height: 24, 
                            fontSize: '0.7rem', 
                            color: 'white',
                            bgcolor: config.color,
                            '& .MuiChip-icon': { color: 'white' }
                        }} 
                    />
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', flexGrow: 1, wordBreak: 'break-word' }}>
                        {log.message}
                    </Typography>
                  </Box>
                  
                  {hasData && (
                    <Accordion sx={{ backgroundColor: 'transparent', boxShadow: 'none', '&:before': {display: 'none'} }}>
                      <AccordionSummary 
                        expandIcon={<ExpandMore fontSize="small" />} 
                        sx={{ 
                            minHeight: '24px', 
                            p: 0,
                            '& .MuiAccordionSummary-content': { m: 0 } 
                        }}
                      >
                        <Typography variant="caption" sx={{ color: 'primary.main', cursor: 'pointer' }}>
                            View Details
                        </Typography>
                      </AccordionSummary>
                      <AccordionDetails sx={{ p: 1, backgroundColor: 'background.paper', borderRadius: 1 }}>
                        <pre style={{ margin: 0, fontSize: '0.75rem', overflowX: 'auto' }}>
                          {JSON.stringify(log.data, null, 2)}
                        </pre>
                      </AccordionDetails>
                    </Accordion>
                  )}
                </Box>
              );
          })
        ) : (
          <Box display="flex" flexDirection="column" justifyContent="center" alignItems="center" height="100%" opacity={0.6}>
            <BugReport fontSize="large" sx={{ mb: 1 }} />
            <Typography>No logs found for <strong>{logLevelFilter.toUpperCase()}</strong> level.</Typography>
            <Typography variant="caption">Try selecting a lower log level (e.g., DEBUG)</Typography>
          </Box>
        )}
      </Box>
    </Paper>
  );
};

export default LogViewer;