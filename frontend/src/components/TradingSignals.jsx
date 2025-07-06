// frontend/src/components/TradingSignals.jsx - Enhanced with Data Building Status
import React, { useEffect, useState } from 'react';
import {
  Paper,
  Typography,
  Card,
  CardContent,
  Grid,
  Chip,
  Box,
  LinearProgress,
  Alert,
  Accordion,
  AccordionSummary,
  AccordionDetails
} from '@mui/material';
import {
  TrendingUp,
  TrendingDown,
  Timeline,
  ErrorOutline,
  HourglassEmpty,
  Block,
  DataUsage,
  ExpandMore,
  CheckCircle,
  Schedule
} from '@mui/icons-material';

const TradingSignals = ({ signals, systemStatus }) => {
  const [dataStatus, setDataStatus] = useState(null);

  // Calculate data building progress
  useEffect(() => {
    if (systemStatus?.services?.binanceData) {
      const binanceStatus = systemStatus.services.binanceData;
      const totalCandles = binanceStatus.totalCandles || 0;
      const assetsCount = systemStatus.config?.assets?.length || 4;
      const timeframesCount = systemStatus.config?.timeframes?.length || 3;
      
      // Calculate expected candles for full analysis
      const expectedCandles = {
        minimal: assetsCount * timeframesCount * 25,  // Basic analysis
        good: assetsCount * timeframesCount * 100,    // Good analysis  
        optimal: assetsCount * timeframesCount * 250  // Full analysis
      };
      
      const progress = {
        current: totalCandles,
        minimal: Math.min((totalCandles / expectedCandles.minimal) * 100, 100),
        good: Math.min((totalCandles / expectedCandles.good) * 100, 100),
        optimal: Math.min((totalCandles / expectedCandles.optimal) * 100, 100)
      };
      
      setDataStatus({
        ...progress,
        expected: expectedCandles,
        phase: getDataPhase(progress),
        isInitializing: totalCandles < expectedCandles.minimal
      });
    }
  }, [systemStatus]);

  const getDataPhase = (progress) => {
    if (progress.optimal >= 100) return 'optimal';
    if (progress.good >= 100) return 'good';
    if (progress.minimal >= 100) return 'minimal';
    return 'building';
  };

  const getPhaseInfo = (phase) => {
    const phases = {
      building: {
        title: 'Building Historical Dataset',
        description: 'Collecting market data for technical analysis',
        color: 'info',
        icon: <DataUsage />,
        status: 'Building foundation data...'
      },
      minimal: {
        title: 'Basic Analysis Ready',
        description: 'Can generate basic trend signals',
        color: 'warning',
        icon: <Schedule />,
        status: 'Limited signal generation active'
      },
      good: {
        title: 'Advanced Analysis Active',
        description: 'Full moving average strategies operational',
        color: 'success',
        icon: <TrendingUp />,
        status: 'Advanced trading signals active'
      },
      optimal: {
        title: 'Full Analysis Operational',
        description: 'All trading strategies at full capacity',
        color: 'success',
        icon: <CheckCircle />,
        status: 'Professional-grade analysis ready'
      }
    };
    return phases[phase] || phases.building;
  };

  const getSignalColor = (signal) => {
    if (!signal) return 'default';
    const upperSignal = signal.toUpperCase();
    if (upperSignal.includes('STRONG_BUY') || upperSignal.includes('BUY')) return 'success';
    if (upperSignal.includes('STRONG_SELL') || upperSignal.includes('SELL')) return 'error';
    if (upperSignal.includes('HOLD')) return 'info';
    if (upperSignal.includes('ERROR')) return 'warning';
    if (upperSignal.includes('INSUFFICIENT')) return 'secondary';
    if (upperSignal.includes('COOLDOWN')) return 'default';
    if (upperSignal.includes('WEAK')) return 'default';
    return 'default';
  };

  const getSignalIcon = (signal) => {
    if (!signal) return <Timeline />;
    const upperSignal = signal.toUpperCase();
    if (upperSignal.includes('BUY')) return <TrendingUp />;
    if (upperSignal.includes('SELL')) return <TrendingDown />;
    if (upperSignal.includes('ERROR')) return <ErrorOutline />;
    if (upperSignal.includes('INSUFFICIENT')) return <DataUsage />;
    if (upperSignal.includes('COOLDOWN')) return <HourglassEmpty />;
    if (upperSignal.includes('HOLD')) return <Block />;
    return <Timeline />;
  };

  const formatSignalTime = (timestamp) => {
    if (!timestamp) return 'Unknown';
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch (error) {
      return 'Invalid time';
    }
  };

  const formatSignalStrength = (strength) => {
    if (typeof strength !== 'number') return '0.0';
    return strength.toFixed(1);
  };

  // Count signal types for status
  const signalCounts = signals?.reduce((counts, signal) => {
    const type = signal.signal || 'UNKNOWN';
    counts[type] = (counts[type] || 0) + 1;
    return counts;
  }, {}) || {};

  const insufficientDataCount = signalCounts['INSUFFICIENT_DATA'] || 0;
  const totalSignals = signals?.length || 0;
  const hasInsufficientData = insufficientDataCount > 0;

  return (
    <Paper sx={{ p: 3, height: 400, overflow: 'auto' }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h6">
          Trading Signals
        </Typography>
        <Box display="flex" gap={1} alignItems="center">
          {dataStatus && (
            <Chip 
              size="small" 
              icon={getPhaseInfo(dataStatus.phase).icon}
              label={dataStatus.phase.charAt(0).toUpperCase() + dataStatus.phase.slice(1)}
              color={getPhaseInfo(dataStatus.phase).color}
            />
          )}
          <Chip 
            size="small" 
            label={`${totalSignals} total`} 
            color="primary" 
          />
        </Box>
      </Box>

      {/* Data Building Status */}
      {dataStatus?.isInitializing && (
        <Alert 
          severity="info" 
          sx={{ mb: 2 }}
          icon={<DataUsage />}
        >
          <Box>
            <Typography variant="body2" fontWeight="bold">
              {getPhaseInfo(dataStatus.phase).title}
            </Typography>
            <Typography variant="caption" display="block">
              {getPhaseInfo(dataStatus.phase).description}
            </Typography>
            
            <Box mt={1}>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={0.5}>
                <Typography variant="caption">
                  Progress: {dataStatus.current} / {dataStatus.expected.minimal} candles
                </Typography>
                <Typography variant="caption">
                  {dataStatus.minimal.toFixed(1)}%
                </Typography>
              </Box>
              <LinearProgress 
                variant="determinate" 
                value={dataStatus.minimal} 
                sx={{ height: 6, borderRadius: 3 }}
              />
              <Typography variant="caption" color="textSecondary" sx={{ mt: 0.5, display: 'block' }}>
                Estimated time: {dataStatus.minimal < 50 ? '2-4 hours' : '30-60 minutes'} for basic signals
              </Typography>
            </Box>
          </Box>
        </Alert>
      )}

      {/* Progress Accordion for Advanced Users */}
      {dataStatus && (
        <Accordion sx={{ mb: 2, backgroundColor: 'background.default' }}>
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Typography variant="body2">
              📊 Data Collection Progress
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Grid container spacing={2}>
              <Grid item xs={4}>
                <Typography variant="caption" color="textSecondary">
                  Basic Analysis
                </Typography>
                <LinearProgress 
                  variant="determinate" 
                  value={dataStatus.minimal} 
                  color="info"
                  sx={{ mt: 0.5, height: 4 }}
                />
                <Typography variant="caption">
                  {dataStatus.minimal.toFixed(0)}%
                </Typography>
              </Grid>
              <Grid item xs={4}>
                <Typography variant="caption" color="textSecondary">
                  Advanced Analysis
                </Typography>
                <LinearProgress 
                  variant="determinate" 
                  value={dataStatus.good} 
                  color="warning"
                  sx={{ mt: 0.5, height: 4 }}
                />
                <Typography variant="caption">
                  {dataStatus.good.toFixed(0)}%
                </Typography>
              </Grid>
              <Grid item xs={4}>
                <Typography variant="caption" color="textSecondary">
                  Optimal Analysis
                </Typography>
                <LinearProgress 
                  variant="determinate" 
                  value={dataStatus.optimal} 
                  color="success"
                  sx={{ mt: 0.5, height: 4 }}
                />
                <Typography variant="caption">
                  {dataStatus.optimal.toFixed(0)}%
                </Typography>
              </Grid>
              <Grid item xs={12}>
                <Typography variant="caption" color="textSecondary">
                  Current dataset: {dataStatus.current} candles across {systemStatus?.config?.assets?.length || 4} assets
                </Typography>
              </Grid>
            </Grid>
          </AccordionDetails>
        </Accordion>
      )}

      {/* Signal List */}
      {!signals || signals.length === 0 ? (
        <Box display="flex" justifyContent="center" alignItems="center" height="200px">
          <Box textAlign="center">
            <DataUsage sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
            <Typography variant="body2" color="textSecondary">
              {dataStatus?.isInitializing ? 'Building dataset...' : 'Waiting for signals...'}
            </Typography>
            <Typography variant="caption" color="textSecondary">
              {dataStatus?.isInitializing ? 'Market data collection in progress' : 'Signal generation will begin shortly'}
            </Typography>
          </Box>
        </Box>
      ) : (
        <Box>
          {signals.slice(0, 20).map((signal, index) => {
            const signalData = {
              symbol: signal?.symbol || 'UNKNOWN',
              signal: signal?.signal || 'UNKNOWN',
              strength: signal?.strength ?? 0,
              timestamp: signal?.timestamp || Date.now(),
              message: signal?.message || '',
              strategy: signal?.strategy || 'unknown',
              currentPrice: signal?.currentPrice,
              originalSignal: signal?.originalSignal,
              candleCount: signal?.candleCount
            };

            const uniqueKey = `${signalData.symbol}-${signalData.timestamp}-${index}`;
            const isInsufficient = signalData.signal === 'INSUFFICIENT_DATA';

            return (
              <Card 
                key={uniqueKey} 
                variant="outlined" 
                sx={{ 
                  mb: 1, 
                  backgroundColor: isInsufficient ? 'action.hover' : 'background.paper',
                  borderColor: isInsufficient ? 'info.main' : 'divider'
                }}
              >
                <CardContent sx={{ py: 1.5, px: 2 }}>
                  <Grid container alignItems="center" spacing={1}>
                    {/* Icon */}
                    <Grid item xs={1}>
                      <Box display="flex" justifyContent="center">
                        {getSignalIcon(signalData.signal)}
                      </Box>
                    </Grid>
                    
                    {/* Asset & Strategy */}
                    <Grid item xs={2}>
                      <Typography variant="body2" fontWeight="bold">
                        {signalData.symbol.replace('USDT', '')}
                      </Typography>
                      <Typography variant="caption" color="textSecondary">
                        {signalData.strategy}
                        {signalData.candleCount && (
                          <span> • {signalData.candleCount}c</span>
                        )}
                      </Typography>
                    </Grid>
                    
                    {/* Signal Type */}
                    <Grid item xs={3}>
                      <Chip
                        size="small"
                        label={signalData.signal.replace('_', ' ')}
                        color={getSignalColor(signalData.signal)}
                        sx={{ fontSize: '0.7rem' }}
                      />
                      {signalData.originalSignal && (
                        <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 0.25 }}>
                          (was: {signalData.originalSignal})
                        </Typography>
                      )}
                    </Grid>
                    
                    {/* Strength */}
                    <Grid item xs={1.5}>
                      <Typography variant="body2" textAlign="center">
                        {formatSignalStrength(signalData.strength)}
                      </Typography>
                      <Typography variant="caption" color="textSecondary" textAlign="center" sx={{ display: 'block' }}>
                        str
                      </Typography>
                    </Grid>
                    
                    {/* Price */}
                    <Grid item xs={2}>
                      {signalData.currentPrice && (
                        <>
                          <Typography variant="body2" textAlign="center">
                            ${signalData.currentPrice.toFixed(signalData.currentPrice > 1 ? 2 : 6)}
                          </Typography>
                          <Typography variant="caption" color="textSecondary" textAlign="center" sx={{ display: 'block' }}>
                            price
                          </Typography>
                        </>
                      )}
                    </Grid>
                    
                    {/* Time */}
                    <Grid item xs={2.5}>
                      <Typography variant="body2" color="textSecondary" textAlign="right">
                        {formatSignalTime(signalData.timestamp)}
                      </Typography>
                    </Grid>
                  </Grid>
                  
                  {/* Enhanced Message for Insufficient Data */}
                  {signalData.message && (
                    <Box mt={1}>
                      <Typography 
                        variant="caption" 
                        color={isInsufficient ? 'info.main' : 'textSecondary'}
                        sx={{ 
                          display: 'block',
                          fontSize: '0.7rem',
                          fontStyle: isInsufficient ? 'normal' : 'italic',
                          fontWeight: isInsufficient ? 500 : 400
                        }}
                      >
                        {isInsufficient ? '📊' : '💬'} {signalData.message}
                        {isInsufficient && signalData.candleCount && (
                          <span> • Currently have {signalData.candleCount} candles</span>
                        )}
                      </Typography>
                    </Box>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </Box>
      )}
      
      {/* Status Summary */}
      <Box mt={2} p={1} sx={{ backgroundColor: 'action.hover', borderRadius: 1 }}>
        <Typography variant="caption" color="textSecondary">
          🔧 Status: {dataStatus ? getPhaseInfo(dataStatus.phase).status : 'Initializing...'} • 
          {totalSignals} signals • Updated {new Date().toLocaleTimeString()}
          {hasInsufficientData && (
            <span> • Building dataset ({insufficientDataCount} assets collecting data)</span>
          )}
        </Typography>
      </Box>
    </Paper>
  );
};

export default TradingSignals;