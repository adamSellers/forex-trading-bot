// frontend/src/components/SystemStatusBanner.jsx - COMPLETE FIXED VERSION
import React from 'react';
import {
  Alert,
  Box,
  Typography,
  LinearProgress,
  Chip,
  Grid,
  Collapse,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Card,
  CardContent
} from '@mui/material';
import {
  DataUsage,
  CheckCircle,
  Schedule,
  TrendingUp,
  Info,
  ExpandMore,
  Timeline,
  Assessment,
  Speed
} from '@mui/icons-material';

const SystemStatusBanner = ({ systemStatus, signals }) => {
  // Early return if no system status
  if (!systemStatus) {
    return (
      <Alert severity="info" sx={{ mb: 2 }}>
        <Typography variant="body2">
          🔄 Connecting to trading system...
        </Typography>
      </Alert>
    );
  }

  const dataServiceStatus = systemStatus.services?.dataService;
  
  if (!dataServiceStatus) {
    return (
      <Alert severity="warning" sx={{ mb: 2 }}>
        <Typography variant="body2">
          ⚠️ Market data service not available
        </Typography>
      </Alert>
    );
  }

  const totalCandles = dataServiceStatus.candleCount || dataServiceStatus.priceCount || 0;
  const candleDatasets = dataServiceStatus.cachedSymbols || dataServiceStatus.instruments?.length || 0;
  const priceStreams = dataServiceStatus.prices || dataServiceStatus.priceCount || 0;
  
  console.log('🔍 SystemStatusBanner Debug:', {
    totalCandles,
    candleDatasets,
    priceStreams,
    dataServiceStatus,
    systemConfig: systemStatus.config
  });
  
  const assetsCount = systemStatus.config?.assets?.length || 0;
  const timeframesCount = systemStatus.config?.timeframes?.length || 0;
  const numberOfDatasets = assetsCount * timeframesCount;

  // Get the per-dataset requirement from the backend. Fallback to 50 if not provided.
  const requiredCandlesPerDataset = systemStatus.requirements?.minCandles || 50;
  
  // Calculate expected candles for different analysis levels
  const expectedCandles = {
    minimal: requiredCandlesPerDataset * numberOfDatasets, 
    good: 100 * numberOfDatasets,     
    optimal: 250 * numberOfDatasets   
  };
  
  // Calculate progress percentages
  const progress = {
    minimal: Math.min((totalCandles / expectedCandles.minimal) * 100, 100),
    good: Math.min((totalCandles / expectedCandles.good) * 100, 100),
    optimal: Math.min((totalCandles / expectedCandles.optimal) * 100, 100)
  };
  
  // Determine current phase
  const getPhase = () => {
    if (totalCandles >= expectedCandles.optimal) return 'optimal';
    if (totalCandles >= expectedCandles.good) return 'good';
    if (totalCandles >= expectedCandles.minimal) return 'minimal';
    return 'building';
  };
  
  const phase = getPhase();
  const isBuilding = phase === 'building';
  
  // Phase configuration
  const phaseConfig = {
    building: {
      severity: 'info',
      icon: <DataUsage />,
      title: 'Building Historical Dataset',
      description: 'Collecting market data for technical analysis. Trading signals will improve as more data is gathered.',
      color: 'info',
      getETA: () => {
        if (progress.minimal < 25) return '2-4 hours';
        if (progress.minimal < 75) return '1-2 hours';
        return '15-30 minutes';
      }
    },
    minimal: {
      severity: 'warning',
      icon: <Schedule />,
      title: 'Basic Analysis Ready',
      description: 'Basic trend analysis is now active. Collecting more data for advanced strategies.',
      color: 'warning',
      getETA: () => {
        if (progress.good < 50) return '4-8 hours';
        return '1-3 hours';
      }
    },
    good: {
      severity: 'success',
      icon: <TrendingUp />,
      title: 'Advanced Analysis Active',
      description: 'Full moving average strategies operational. Building dataset for optimal performance.',
      color: 'success',
      getETA: () => 'Days to weeks for full optimization'
    },
    optimal: {
      severity: 'success',
      icon: <CheckCircle />,
      title: 'Professional-Grade Analysis Ready',
      description: 'All trading strategies operating at full capacity with comprehensive historical data.',
      color: 'success',
      getETA: () => null
    }
  };

  const config = phaseConfig[phase];
  
  // Count insufficient data signals
  const insufficientSignals = signals?.filter(s => s.signal === 'INSUFFICIENT_DATA').length || 0;
  const totalSignals = signals?.length || 0;
  const activeSignals = totalSignals - insufficientSignals;

  // Calculate estimated completion time
  const getCompletionEstimate = () => {
    if (phase === 'optimal') return null;
    
    const needed = expectedCandles.minimal - totalCandles;
    if (needed <= 0) return null;
    
    // Estimate based on current collection rate (assume 1 candle per hour per timeframe)
    const hoursNeeded = Math.ceil(needed / (assetsCount * timeframesCount));
    
    if (hoursNeeded < 1) return 'Less than 1 hour';
    if (hoursNeeded < 24) return `${hoursNeeded} hours`;
    return `${Math.ceil(hoursNeeded / 24)} days`;
  };

  // Hide banner when system is optimal and working well
  if (phase === 'optimal' && insufficientSignals === 0) {
    return null;
  }

  return (
    <Collapse in={true}>
      <Alert 
        severity={config.severity}
        icon={config.icon}
        sx={{ mb: 2 }}
        action={
          <Box display="flex" gap={1} alignItems="center" flexWrap="wrap">
            <Chip
              size="small"
              label={`${totalCandles} candles`}
              color="primary"
              variant="outlined"
            />
            <Chip
              size="small"
              label={`${candleDatasets} datasets`}
              color="secondary"
              variant="outlined"
            />
            <Chip
              size="small"
              label={phase.charAt(0).toUpperCase() + phase.slice(1)}
              color={config.color}
            />
          </Box>
        }
      >
        <Box>
          <Typography variant="body1" fontWeight="bold" gutterBottom>
            {config.title}
          </Typography>
          
          <Typography variant="body2" paragraph>
            {config.description}
          </Typography>

          {/* Progress Section for Building Phase */}
          {isBuilding && (
            <Box mb={2}>
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} md={8}>
                  <Box>
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={0.5}>
                      <Typography variant="caption">
                        Dataset Progress: {totalCandles} / {expectedCandles.minimal} candles for basic analysis
                      </Typography>
                      <Typography variant="caption" fontWeight="bold">
                        {progress.minimal.toFixed(1)}%
                      </Typography>
                    </Box>
                    <LinearProgress 
                      variant="determinate" 
                      value={progress.minimal} 
                      sx={{ 
                        height: 8, 
                        borderRadius: 4,
                        backgroundColor: 'rgba(255,255,255,0.1)',
                        '& .MuiLinearProgress-bar': {
                          borderRadius: 4
                        }
                      }}
                    />
                  </Box>
                </Grid>
                
                <Grid item xs={12} md={4}>
                  <Box textAlign={{ xs: 'left', md: 'right' }}>
                    <Typography variant="caption" color="textSecondary">
                      Estimated time to basic signals:
                    </Typography>
                    <Typography variant="body2" fontWeight="bold">
                      {getCompletionEstimate() || config.getETA()}
                    </Typography>
                  </Box>
                </Grid>
              </Grid>
            </Box>
          )}

          {/* Enhanced Progress Accordion */}
          <Accordion sx={{ backgroundColor: 'rgba(255,255,255,0.05)', mt: 1 }}>
            <AccordionSummary 
              expandIcon={<ExpandMore />}
              sx={{ minHeight: 40, '& .MuiAccordionSummary-content': { margin: '8px 0' } }}
            >
              <Box display="flex" alignItems="center" gap={1}>
                <Assessment fontSize="small" />
                <Typography variant="body2">
                  📊 Detailed Progress & System Health
                </Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              {/* Progress Bars */}
              <Grid container spacing={2} mb={2}>
                <Grid item xs={12} md={4}>
                  <Card variant="outlined" sx={{ backgroundColor: 'rgba(255,255,255,0.02)' }}>
                    <CardContent sx={{ py: 1.5 }}>
                      <Typography variant="caption" color="textSecondary" gutterBottom>
                        Basic Analysis
                      </Typography>
                      <LinearProgress 
                        variant="determinate" 
                        value={progress.minimal} 
                        color="info"
                        sx={{ mt: 0.5, height: 6, borderRadius: 3 }}
                      />
                      <Box display="flex" justifyContent="space-between" mt={0.5}>
                        <Typography variant="caption">
                          {progress.minimal.toFixed(1)}%
                        </Typography>
                        <Typography variant="caption">
                          {totalCandles}/{expectedCandles.minimal}
                        </Typography>
                      </Box>
                    </CardContent>
                  </Card>
                </Grid>
                
                <Grid item xs={12} md={4}>
                  <Card variant="outlined" sx={{ backgroundColor: 'rgba(255,255,255,0.02)' }}>
                    <CardContent sx={{ py: 1.5 }}>
                      <Typography variant="caption" color="textSecondary" gutterBottom>
                        Advanced Analysis
                      </Typography>
                      <LinearProgress 
                        variant="determinate" 
                        value={progress.good} 
                        color="warning"
                        sx={{ mt: 0.5, height: 6, borderRadius: 3 }}
                      />
                      <Box display="flex" justifyContent="space-between" mt={0.5}>
                        <Typography variant="caption">
                          {progress.good.toFixed(1)}%
                        </Typography>
                        <Typography variant="caption">
                          {totalCandles}/{expectedCandles.good}
                        </Typography>
                      </Box>
                    </CardContent>
                  </Card>
                </Grid>
                
                <Grid item xs={12} md={4}>
                  <Card variant="outlined" sx={{ backgroundColor: 'rgba(255,255,255,0.02)' }}>
                    <CardContent sx={{ py: 1.5 }}>
                      <Typography variant="caption" color="textSecondary" gutterBottom>
                        Optimal Analysis
                      </Typography>
                      <LinearProgress 
                        variant="determinate" 
                        value={progress.optimal} 
                        color="success"
                        sx={{ mt: 0.5, height: 6, borderRadius: 3 }}
                      />
                      <Box display="flex" justifyContent="space-between" mt={0.5}>
                        <Typography variant="caption">
                          {progress.optimal.toFixed(1)}%
                        </Typography>
                        <Typography variant="caption">
                          {totalCandles}/{expectedCandles.optimal}
                        </Typography>
                      </Box>
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>
              
              {/* System Stats */}
              <Grid container spacing={2}>
                <Grid item xs={6} md={3}>
                  <Box textAlign="center">
                    <Typography variant="h6" color="primary">
                      {assetsCount}
                    </Typography>
                    <Typography variant="caption" color="textSecondary">
                      Trading Assets
                    </Typography>
                  </Box>
                </Grid>
                <Grid item xs={6} md={3}>
                  <Box textAlign="center">
                    <Typography variant="h6" color="secondary">
                      {timeframesCount}
                    </Typography>
                    <Typography variant="caption" color="textSecondary">
                      Timeframes
                    </Typography>
                  </Box>
                </Grid>
                <Grid item xs={6} md={3}>
                  <Box textAlign="center">
                    <Typography variant="h6" color="success.main">
                      {activeSignals}
                    </Typography>
                    <Typography variant="caption" color="textSecondary">
                      Active Signals
                    </Typography>
                  </Box>
                </Grid>
                <Grid item xs={6} md={3}>
                  <Box textAlign="center">
                    <Typography variant="h6" color="info.main">
                      {priceStreams}
                    </Typography>
                    <Typography variant="caption" color="textSecondary">
                      Price Streams
                    </Typography>
                  </Box>
                </Grid>
              </Grid>
              
              {/* Additional Info */}
              <Box mt={2} p={1} sx={{ backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 1 }}>
                <Typography variant="caption" color="textSecondary">
                  💡 <strong>System Status:</strong> {systemStatus.isInitialized ? '🟢 Online' : '🔴 Offline'} •
                  <strong> Data Collection:</strong> {(dataServiceStatus.ready || dataServiceStatus.isRunning) ? '🟢 Active' : '🔴 Inactive'} • 
                  <strong> Assets Building:</strong> {insufficientSignals} • 
                  <strong> Last Update:</strong> {dataServiceStatus.lastUpdate ? new Date(dataServiceStatus.lastUpdate).toLocaleTimeString() : 'Never'}
                </Typography>
              </Box>
            </AccordionDetails>
          </Accordion>

          {/* Phase-specific messages */}
          {phase === 'minimal' && (
            <Box mt={1}>
              <Typography variant="caption" color="success.main">
                🎯 <strong>Milestone Reached!</strong> Basic signals are now available. Advanced strategies will activate as more data is collected.
              </Typography>
            </Box>
          )}

          {phase === 'good' && (
            <Box mt={1}>
              <Typography variant="caption" color="success.main">
                🚀 <strong>Advanced Analysis Active!</strong> Full moving average strategies are operational. System continues optimizing.
              </Typography>
            </Box>
          )}

          {insufficientSignals > 0 && totalSignals > 0 && (
            <Box mt={1}>
              <Typography variant="caption" color="info.main">
                📊 <strong>Signal Status:</strong> {activeSignals} assets generating signals, {insufficientSignals} still building datasets
              </Typography>
            </Box>
          )}

          {/* Data collection rate info */}
          {isBuilding && totalCandles > 0 && (
            <Box mt={1}>
              <Typography variant="caption" color="textSecondary">
                ⏱️ <strong>Collection Rate:</strong> Approximately {Math.ceil(totalCandles / Math.max(1, (Date.now() - (systemStatus.startTime || Date.now())) / 3600000))} candles per hour
              </Typography>
            </Box>
          )}
        </Box>
      </Alert>
    </Collapse>
  );
};

export default SystemStatusBanner;
