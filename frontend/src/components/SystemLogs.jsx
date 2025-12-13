// frontend/src/components/SystemLogs.jsx - FIXED LINTER WARNING
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Typography, Box, ToggleButtonGroup, ToggleButton, Button,
  Accordion, AccordionSummary, AccordionDetails, CircularProgress,
  Alert, Chip, Container, Stack, styled, alpha, Paper, useTheme, IconButton, Tooltip
} from '@mui/material';
import { 
  Refresh as RefreshIcon, ExpandMore, BugReport, Info, 
  Warning, Error as ErrorIcon, CheckCircle, Terminal, 
  FilterList, Download
} from '@mui/icons-material';
import { managementAPI } from '../config/api';

// --- STYLED COMPONENTS ---
const GlassCard = styled(Paper)(({ theme }) => ({
  background: alpha(theme.palette.background.paper, 0.05),
  backdropFilter: 'blur(10px)',
  border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  borderRadius: theme.shape.borderRadius * 2,
  boxShadow: '0 4px 30px rgba(0, 0, 0, 0.1)',
  height: '100%',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  transition: 'border-color 0.3s ease',
  '&:hover': {
    borderColor: alpha(theme.palette.primary.main, 0.3),
  }
}));

const LogRow = styled(Box)(({ theme, level }) => ({
  display: 'flex',
  alignItems: 'flex-start',
  padding: theme.spacing(1.5),
  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.05)}`,
  fontFamily: '"Roboto Mono", monospace',
  fontSize: '0.85rem',
  transition: 'background-color 0.1s',
  '&:hover': {
    backgroundColor: alpha(theme.palette.action.hover, 0.1),
  },
  borderLeft: `3px solid ${
    level === 'error' ? theme.palette.error.main : 
    level === 'warn' ? theme.palette.warning.main : 
    level === 'success' ? theme.palette.success.main : 
    'transparent'
  }`
}));

const CodeBlock = styled('pre')(({ theme }) => ({
  margin: 0,
  padding: theme.spacing(2),
  backgroundColor: alpha('#000', 0.3),
  borderRadius: theme.shape.borderRadius,
  border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  overflowX: 'auto',
  fontFamily: '"Fira Code", "Roboto Mono", monospace',
  fontSize: '0.75rem',
  color: theme.palette.text.secondary
}));

// --- CONSTANTS (Moved outside component to fix linter warning) ---
const LOG_LEVELS = { debug: 0, info: 1, success: 1, warn: 2, error: 3 };

const LogViewer = () => {
  const theme = useTheme();
  const [logs, setLogs] = useState([]);
  const [logLevelFilter, setLogLevelFilter] = useState('info'); 
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // 1. Fetch Logs
  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await managementAPI.getLogs({ level: 'debug', limit: 200 });
      
      let parsedLogs = [];
      if (Array.isArray(response)) parsedLogs = response;
      else if (response?.logs && Array.isArray(response.logs)) parsedLogs = response.logs;
      else if (response?.data && Array.isArray(response.data)) parsedLogs = response.data;

      setLogs(parsedLogs);
    } catch (err) {
      console.error("Log Fetch Error:", err);
      setError(`Failed to load logs: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  // 2. Filter Logic
  const filteredLogs = useMemo(() => {
    if (!logs.length) return [];
    const minPriority = LOG_LEVELS[logLevelFilter] || 0;
    return logs.filter(log => {
        const level = (log.level || 'info').toLowerCase();
        const priority = LOG_LEVELS[level] !== undefined ? LOG_LEVELS[level] : 1;
        return priority >= minPriority;
    });
  }, [logs, logLevelFilter]);

  // 3. UI Helpers
  const getLogMeta = (level) => {
    const normalized = (level || 'info').toLowerCase();
    switch (normalized) {
      case 'error': return { color: 'error', icon: <ErrorIcon style={{ fontSize: 16 }} /> };
      case 'warn': return { color: 'warning', icon: <Warning style={{ fontSize: 16 }} /> };
      case 'success': return { color: 'success', icon: <CheckCircle style={{ fontSize: 16 }} /> };
      case 'debug': return { color: 'default', icon: <BugReport style={{ fontSize: 16 }} /> };
      default: return { color: 'info', icon: <Info style={{ fontSize: 16 }} /> };
    }
  };

  const handleExport = () => {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(filteredLogs, null, 2));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", `system_logs_${new Date().toISOString()}.json`);
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
  };

  return (
    <Container maxWidth={false} sx={{ py: 2, height: '100vh', display: 'flex', flexDirection: 'column' }}>
      
      {/* HEADER */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3} px={1}>
        <Box>
            <Typography variant="h4" fontWeight="900" sx={{ letterSpacing: -1 }}>
                SYSTEM <span style={{ color: theme.palette.primary.main }}>LOGS</span>
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 1 }}>
                OPERATIONAL AUDIT TRAIL
            </Typography>
        </Box>
        
        <Stack direction="row" spacing={2} alignItems="center">
             <ToggleButtonGroup
                value={logLevelFilter}
                exclusive
                onChange={(e, newLevel) => newLevel && setLogLevelFilter(newLevel)}
                size="small"
                sx={{ 
                    bgcolor: alpha(theme.palette.background.paper, 0.1), 
                    backdropFilter: 'blur(5px)',
                    border: `1px solid ${alpha(theme.palette.divider, 0.1)}`
                }}
              >
                <ToggleButton value="debug" sx={{ px: 2, fontWeight: 'bold', fontSize: '0.7rem' }}>DEBUG</ToggleButton>
                <ToggleButton value="info" sx={{ px: 2, fontWeight: 'bold', fontSize: '0.7rem' }}>INFO</ToggleButton>
                <ToggleButton value="warn" sx={{ px: 2, fontWeight: 'bold', fontSize: '0.7rem', color: 'warning.main' }}>WARN</ToggleButton>
                <ToggleButton value="error" sx={{ px: 2, fontWeight: 'bold', fontSize: '0.7rem', color: 'error.main' }}>ERROR</ToggleButton>
              </ToggleButtonGroup>

              <Tooltip title="Export Current View">
                  <IconButton onClick={handleExport} size="small" sx={{ border: 1, borderColor: 'divider' }}>
                      <Download fontSize="small" />
                  </IconButton>
              </Tooltip>

              <Button variant="outlined" startIcon={<RefreshIcon />} onClick={fetchLogs} disabled={loading} color="inherit">
                REFRESH
              </Button>
        </Stack>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* LOG TERMINAL */}
      <GlassCard sx={{ flexGrow: 1, minHeight: 0, bgcolor: alpha('#000', 0.2) }}>
        
        {/* Terminal Header */}
        <Box 
            p={1.5} 
            borderBottom={`1px solid ${alpha(theme.palette.divider, 0.1)}`} 
            bgcolor={alpha(theme.palette.background.paper, 0.05)}
            display="flex" 
            alignItems="center" 
            justifyContent="space-between"
        >
            <Box display="flex" alignItems="center" gap={1}>
                <Terminal fontSize="small" color="primary" />
                <Typography variant="subtitle2" fontFamily="monospace" fontWeight="bold" color="text.secondary">
                    /var/log/trading_engine.log
                </Typography>
            </Box>
            <Chip 
                label={`${filteredLogs.length} EVENTS`} 
                size="small" 
                sx={{ height: 20, fontSize: '0.65rem', borderRadius: 1 }} 
            />
        </Box>

        {/* Log Stream */}
        <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 0 }}>
            {loading ? (
                <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" height="100%" gap={2}>
                    <CircularProgress size={30} />
                    <Typography variant="caption" fontFamily="monospace">FETCHING TELEMETRY...</Typography>
                </Box>
            ) : filteredLogs.length > 0 ? (
                filteredLogs.map((log, index) => {
                    const meta = getLogMeta(log.level);
                    const hasData = log.data && Object.keys(log.data).length > 0;
                    const timestamp = log.timestamp || log.time || new Date().toISOString();
                    
                    return (
                        <Accordion 
                            key={index} 
                            disableGutters 
                            elevation={0}
                            sx={{ bgcolor: 'transparent', '&:before': { display: 'none' } }}
                        >
                            <AccordionSummary 
                                expandIcon={hasData ? <ExpandMore sx={{ fontSize: 16, opacity: 0.5 }} /> : null}
                                sx={{ 
                                    minHeight: 0, 
                                    p: 0,
                                    '& .MuiAccordionSummary-content': { m: 0 },
                                    cursor: hasData ? 'pointer' : 'default'
                                }}
                            >
                                <LogRow width="100%" level={log.level?.toLowerCase()}>
                                    {/* Timestamp */}
                                    <Typography 
                                        variant="caption" 
                                        sx={{ 
                                            minWidth: 90, 
                                            color: 'text.secondary', 
                                            fontFamily: 'monospace', 
                                            opacity: 0.7,
                                            mr: 2 
                                        }}
                                    >
                                        {new Date(timestamp).toLocaleTimeString([], { hour12: false })}
                                    </Typography>

                                    {/* Tag */}
                                    <Chip 
                                        label={(log.level || 'INFO').toUpperCase()} 
                                        size="small" 
                                        color={meta.color}
                                        variant="outlined"
                                        icon={meta.icon}
                                        sx={{ 
                                            height: 20, 
                                            fontSize: '0.65rem', 
                                            fontWeight: 'bold', 
                                            mr: 2, 
                                            minWidth: 70,
                                            justifyContent: 'flex-start'
                                        }} 
                                    />

                                    {/* Message */}
                                    <Typography 
                                        variant="body2" 
                                        sx={{ 
                                            fontFamily: 'monospace', 
                                            fontSize: '0.8rem', 
                                            color: 'text.primary',
                                            flexGrow: 1,
                                            wordBreak: 'break-word'
                                        }}
                                    >
                                        {log.message}
                                    </Typography>
                                </LogRow>
                            </AccordionSummary>
                            
                            {/* Detailed JSON View */}
                            {hasData && (
                                <AccordionDetails sx={{ p: 0, pl: 2, bgcolor: alpha(theme.palette.background.default, 0.3) }}>
                                    <CodeBlock>
                                        {JSON.stringify(log.data, null, 2)}
                                    </CodeBlock>
                                </AccordionDetails>
                            )}
                        </Accordion>
                    );
                })
            ) : (
                <Box display="flex" flexDirection="column" justifyContent="center" alignItems="center" height="100%" opacity={0.3}>
                    <FilterList sx={{ fontSize: 48, mb: 1 }} />
                    <Typography fontFamily="monospace">NO LOGS MATCHING FILTER</Typography>
                </Box>
            )}
        </Box>
      </GlassCard>
    </Container>
  );
};

export default LogViewer;