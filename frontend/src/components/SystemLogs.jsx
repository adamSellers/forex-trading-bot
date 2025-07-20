import React, { useState, useEffect, useCallback } from 'react';
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
  Alert
} from '@mui/material';
import { Refresh as RefreshIcon, ExpandMore } from '@mui/icons-material';
import { managementAPI } from '../config/api';

const LogViewer = () => {
  const [logs, setLogs] = useState([]);
  const [logLevelFilter, setLogLevelFilter] = useState('info');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const logData = await managementAPI.getLogs({ level: logLevelFilter, limit: 200 });
      setLogs(logData.logs || []);
    } catch (err) {
      setError(`Failed to load logs: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [logLevelFilter]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const getLogLevelColor = (level) => {
    switch (level?.toLowerCase()) {
      case 'error': return 'error.main';
      case 'warn': return 'warning.main';
      case 'success': return 'success.main';
      case 'debug': return 'grey.500';
      default: return 'info.main';
    }
  };

  return (
    <Paper sx={{ p: 3, width: '100%', boxSizing: 'border-box' }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h4">System Logs</Typography>
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
            {loading ? 'Refreshing...' : 'Refresh'}
          </Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Box sx={{ height: 600, overflowY: 'auto', p: 2, backgroundColor: 'background.default', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
        {loading ? (
          <Box display="flex" justifyContent="center" alignItems="center" height="100%">
            <CircularProgress />
            <Typography sx={{ ml: 2 }}>Loading Logs...</Typography>
          </Box>
        ) : logs.length > 0 ? (
          logs.map((log, index) => (
            <Box key={index} sx={{ mb: 1, fontFamily: 'monospace', fontSize: '0.8rem', borderBottom: '1px solid #2a2a2a', pb: 1 }}>
              <Typography component="span" sx={{ color: 'grey.600', mr: 1 }}>
                {new Date(log.timestamp).toLocaleTimeString()}
              </Typography>
              <Typography component="span" sx={{ color: getLogLevelColor(log.level), mx: 1, fontWeight: 'bold' }}>
                [{log.level.toUpperCase()}]
              </Typography>
              <Typography component="span">{log.message}</Typography>
              {log.data && (
                <Accordion sx={{ my: 1, backgroundColor: 'rgba(255,255,255,0.05)', boxShadow: 'none' }}>
                  <AccordionSummary expandIcon={<ExpandMore />} sx={{ minHeight: '30px', '& .MuiAccordionSummary-content': { my: 0 } }}>
                    <Typography variant="caption" sx={{ fontStyle: 'italic' }}>View Data</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0, fontSize: '0.75rem', color: '#ccc' }}>
                      {JSON.stringify(log.data, null, 2)}
                    </pre>
                  </AccordionDetails>
                </Accordion>
              )}
            </Box>
          ))
        ) : (
          <Box display="flex" justifyContent="center" alignItems="center" height="100%">
            <Typography color="text.secondary">No logs found for this level.</Typography>
          </Box>
        )}
      </Box>
    </Paper>
  );
};

export default LogViewer;