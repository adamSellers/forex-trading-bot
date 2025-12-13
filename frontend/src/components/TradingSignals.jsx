// frontend/src/components/TradingSignals.jsx - FINAL FIX
import React, { useMemo } from 'react';
import { 
    Paper, Typography, Card, CardContent, Grid, Chip, Box, LinearProgress, 
    Stack, Avatar, useTheme, alpha 
} from '@mui/material';
import { 
    TrendingUp, TrendingDown, Timeline, HourglassEmpty, Block, 
    DataUsage, Radar 
} from '@mui/icons-material';

const TradingSignals = ({ signals, systemStatus, compact = false }) => {
  const theme = useTheme();

  // Data Collection Status Logic
  const dataStatus = useMemo(() => {
      if (!systemStatus?.services?.binanceData) return null;
      const { candleCount: totalCandles = 0 } = systemStatus.services.binanceData;
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
    return 'default';
  };

  const getSignalIcon = (signal) => {
    const s = signal?.toUpperCase() || '';
    if (s.includes('BUY')) return <TrendingUp fontSize="small" />;
    if (s.includes('SELL')) return <TrendingDown fontSize="small" />;
    return <Timeline fontSize="small" />;
  };

  // --- RENDERERS ---

  if (compact) {
      return (
        <Stack spacing={0}>
            {!signals || signals.length === 0 ? (
                <Box textAlign="center" py={4} color="text.secondary">
                    <Radar sx={{ fontSize: 40, opacity: 0.3, mb: 1 }} />
                    <Typography variant="caption" display="block">SCANNING MARKET...</Typography>
                </Box>
            ) : (
                signals.map((signal, index) => {
                    const color = getSignalColor(signal.signal);
                    return (
                        <Box 
                            key={`${signal.symbol}-${index}`} 
                            sx={{ 
                                p: 1.5, 
                                borderBottom: 1, 
                                borderColor: 'divider',
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'space-between',
                                '&:hover': { bgcolor: 'action.hover' }
                            }}
                        >
                            <Box display="flex" alignItems="center" gap={1.5}>
                                <Avatar 
                                    variant="rounded" 
                                    sx={{ 
                                        width: 28, height: 28, 
                                        bgcolor: alpha(theme.palette[color].main, 0.1), 
                                        color: `${color}.main` 
                                    }}
                                >
                                    {getSignalIcon(signal.signal)}
                                </Avatar>
                                <Box>
                                    <Typography variant="body2" fontWeight="bold">
                                        {signal.symbol.replace('USDT', '')}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', gap: 1 }}>
                                        {new Date(signal.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                    </Typography>
                                </Box>
                            </Box>
                            
                            <Box textAlign="right">
                                <Chip 
                                    label={signal.signal.split('_')[0]} 
                                    size="small" 
                                    color={color} 
                                    variant="filled"
                                    sx={{ height: 20, fontSize: '0.65rem', fontWeight: 'bold' }}
                                />
                                <Typography variant="caption" display="block" color="text.secondary" mt={0.5}>
                                    ADX: {signal.strength?.toFixed(0)}
                                </Typography>
                            </Box>
                        </Box>
                    );
                })
            )}
        </Stack>
      );
  }

  // Full View (Dashboard Widget)
  return (
    <Box height="100%" display="flex" flexDirection="column">
      <Box display="flex" justifyContent="space-between" mb={2} alignItems="center">
        <Typography variant="h6" fontWeight="bold">Active Signals</Typography>
        <Box display="flex" gap={1}>
            {dataStatus && (
                <Chip 
                    label={dataStatus.phase.toUpperCase()} 
                    color={dataStatus.phase === 'optimal' ? 'success' : 'warning'} 
                    size="small" 
                    icon={<DataUsage />}
                    variant="outlined"
                />
            )}
            <Chip size="small" label={`${signals?.length || 0} ACTIVE`} color="primary" />
        </Box>
      </Box>

      {dataStatus && dataStatus.percent < 100 && (
          <Box mb={2} sx={{ bgcolor: 'background.paper', p: 1, borderRadius: 1 }}>
              <Box display="flex" justifyContent="space-between" mb={0.5}>
                  <Typography variant="caption" color="textSecondary">Neural Net Training Progress</Typography>
                  <Typography variant="caption">{Math.round(dataStatus.percent)}%</Typography>
              </Box>
              <LinearProgress variant="determinate" value={dataStatus.percent} sx={{ height: 6, borderRadius: 3 }} />
          </Box>
      )}

      <Stack spacing={1} sx={{ flexGrow: 1, overflowY: 'auto' }}>
        {!signals || signals.length === 0 ? (
           <Box textAlign="center" py={6} sx={{ opacity: 0.5 }}>
              <HourglassEmpty sx={{ fontSize: 40, mb: 1 }} />
              <Typography variant="body2">Waiting for market triggers...</Typography>
          </Box>
        ) : (
          signals.map((signal, index) => (
            <Card key={`${signal.symbol}-${index}`} variant="outlined" sx={{ bgcolor: 'background.default' }}>
              <CardContent sx={{ p: '12px !important' }}>
                <Grid container alignItems="center" spacing={2}>
                  <Grid item xs={1} display="flex" justifyContent="center">
                    {getSignalIcon(signal.signal)}
                  </Grid>
                  <Grid item xs={3}>
                    <Typography variant="subtitle2" fontWeight="bold">{signal.symbol.replace('USDT', '')}</Typography>
                    <Typography variant="caption" color="textSecondary">{new Date(signal.timestamp).toLocaleTimeString()}</Typography>
                  </Grid>
                  <Grid item xs={4}>
                    <Chip 
                      size="small" 
                      label={signal.signal.replace('_', ' ')} 
                      color={getSignalColor(signal.signal)} 
                      sx={{ width: '100%', fontWeight: 'bold' }}
                    />
                  </Grid>
                  <Grid item xs={4}>
                    <Box display="flex" flexDirection="column" alignItems="flex-end">
                        <Typography variant="caption" fontWeight="bold">ADX: {signal.strength?.toFixed(1)}</Typography>
                        {signal.currentPrice && <Typography variant="caption" fontFamily="monospace">${signal.currentPrice.toFixed(2)}</Typography>}
                    </Box>
                  </Grid>
                </Grid>
                {signal.message && (
                    <Box mt={1} p={0.5} bgcolor={alpha(theme.palette.text.primary, 0.03)} borderRadius={1}>
                        <Typography variant="caption" color="textSecondary" fontStyle="italic">
                            &quot;{signal.message}&quot;
                        </Typography>
                    </Box>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </Stack>
    </Box>
  );
};

export default TradingSignals;