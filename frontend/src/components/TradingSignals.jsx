// frontend/src/components/TradingSignals.jsx - FIXED & RESTORED
import React, { useMemo } from 'react';
import { 
    Paper, Typography, Card, CardContent, Grid, Chip, Box, Alert, LinearProgress, Accordion, AccordionSummary, AccordionDetails 
} from '@mui/material';
import { 
    TrendingUp, TrendingDown, Timeline, HourglassEmpty, Block, DataUsage, ExpandMore, CheckCircle 
} from '@mui/icons-material';

const TradingSignals = ({ signals, systemStatus }) => {
  
  // RESTORED: Data Collection Status Logic
  const dataStatus = useMemo(() => {
      if (!systemStatus?.services?.binanceData) return null;
      
      const { candleCount: totalCandles = 0 } = systemStatus.services.binanceData;
      // Estimates based on typical config (e.g. 5 assets * 3 timeframes * 200 candles)
      const target = 3000; 
      const percent = Math.min((totalCandles / target) * 100, 100);
      
      let phase = 'building';
      if (percent > 90) phase = 'optimal';
      else if (percent > 50) phase = 'good';
      else if (percent > 20) phase = 'minimal';

      return { totalCandles, percent, phase };
  }, [systemStatus]);

  const getSignalColor = (signal) => {
    if (!signal) return 'default';
    const s = signal.toUpperCase();
    if (s.includes('BUY')) return 'success';
    if (s.includes('SELL')) return 'error';
    if (s.includes('HOLD')) return 'info';
    return 'default';
  };

  const getSignalIcon = (signal) => {
    if (!signal) return <Timeline />;
    const s = signal.toUpperCase();
    if (s.includes('BUY')) return <TrendingUp />;
    if (s.includes('SELL')) return <TrendingDown />;
    if (s.includes('HOLD')) return <Block />;
    return <HourglassEmpty />;
  };

  return (
    <Paper sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box display="flex" justifyContent="space-between" mb={2} alignItems="center">
        <Typography variant="h6">Trading Signals</Typography>
        <Box display="flex" gap={1}>
            {dataStatus && (
                <Chip 
                    label={dataStatus.phase.toUpperCase()} 
                    color={dataStatus.phase === 'optimal' ? 'success' : 'warning'} 
                    size="small" 
                    icon={<DataUsage />}
                />
            )}
            <Chip size="small" label={`${signals?.length || 0} Active`} color="primary" variant="outlined" />
        </Box>
      </Box>

      {/* RESTORED: Data Progress Bar */}
      {dataStatus && dataStatus.percent < 100 && (
          <Box mb={2}>
              <Box display="flex" justifyContent="space-between">
                  <Typography variant="caption" color="textSecondary">Data Collection Progress</Typography>
                  <Typography variant="caption">{dataStatus.totalCandles} candles</Typography>
              </Box>
              <LinearProgress variant="determinate" value={dataStatus.percent} sx={{ mt: 0.5, borderRadius: 2 }} />
          </Box>
      )}

      <Box sx={{ flexGrow: 1, overflowY: 'auto', maxHeight: '500px' }}>
        {!signals || signals.length === 0 ? (
          <Box textAlign="center" py={4}>
              <Typography color="textSecondary">Waiting for signals...</Typography>
              {dataStatus?.phase === 'building' && (
                  <Typography variant="caption" color="warning.main">System is collecting historical data</Typography>
              )}
          </Box>
        ) : (
          signals.map((signal, index) => (
            <Card key={`${signal.symbol}-${index}`} variant="outlined" sx={{ mb: 1 }}>
              <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
                <Grid container alignItems="center" spacing={2}>
                  <Grid item xs={1}>{getSignalIcon(signal.signal)}</Grid>
                  <Grid item xs={3}>
                    <Typography variant="subtitle2">{signal.symbol.replace('USDT', '')}</Typography>
                    <Typography variant="caption" color="textSecondary">{new Date(signal.timestamp).toLocaleTimeString()}</Typography>
                  </Grid>
                  <Grid item xs={4}>
                    <Chip 
                      size="small" 
                      label={signal.signal.replace('_', ' ')} 
                      color={getSignalColor(signal.signal)} 
                      sx={{ width: '100%' }}
                    />
                  </Grid>
                  <Grid item xs={4}>
                    <Box display="flex" flexDirection="column" alignItems="flex-end">
                        <Typography variant="caption">ADX: {signal.strength?.toFixed(1)}</Typography>
                        {signal.currentPrice && <Typography variant="caption">${signal.currentPrice.toFixed(2)}</Typography>}
                    </Box>
                  </Grid>
                </Grid>
                {signal.message && (
                    <Typography variant="caption" display="block" mt={0.5} color="textSecondary" fontStyle="italic">
                        {signal.message}
                    </Typography>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </Box>
    </Paper>
  );
};

export default TradingSignals;