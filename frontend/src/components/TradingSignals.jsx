// frontend/src/components/TradingSignals.jsx - FINAL FIX
import React, { useMemo } from 'react';
import { 
    Typography, Box, LinearProgress, Stack, Avatar, 
    useTheme, alpha, Chip, styled
} from '@mui/material';
import { 
    TrendingUp, TrendingDown, Timeline, Radar, 
    AutoGraph
} from '@mui/icons-material';

// --- STYLED COMPONENTS ---
// Fixed: Removed unused 'type' prop from destructuring
const SignalRow = styled(Box)(({ theme }) => ({
    padding: theme.spacing(1.5),
    borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    transition: 'background-color 0.2s ease',
    cursor: 'default',
    '&:hover': {
        backgroundColor: alpha(theme.palette.action.hover, 0.05),
    },
    '&:last-child': {
        borderBottom: 'none'
    }
}));

const MonoText = styled(Typography)(({ theme, color }) => ({
    fontFamily: '"Roboto Mono", monospace',
    fontWeight: 500,
    color: color || theme.palette.text.secondary,
    fontSize: '0.75rem'
}));

const TradingSignals = ({ signals, systemStatus, compact = false }) => {
  const theme = useTheme();

  // --- LOGIC: Signal Colors ---
  const getSignalMeta = (signalType) => {
    const s = (signalType || '').toUpperCase();
    if (s.includes('BUY')) return { color: 'success', icon: <TrendingUp fontSize="small" /> };
    if (s.includes('SELL')) return { color: 'error', icon: <TrendingDown fontSize="small" /> };
    return { color: 'info', icon: <Timeline fontSize="small" /> }; // Fallback to 'info' to prevent crash
  };

  // --- LOGIC: System Health ---
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

  // --- RENDERERS ---

  // 1. EMPTY STATE
  if (!signals || signals.length === 0) {
      return (
        <Box 
            height="100%" 
            display="flex" 
            flexDirection="column" 
            alignItems="center" 
            justifyContent="center" 
            color="text.secondary"
            p={4}
        >
            <Radar sx={{ fontSize: 48, opacity: 0.2, mb: 2, animation: 'pulse 2s infinite' }} />
            <Typography variant="body2" fontWeight="bold">NEURAL NET SCANNING</Typography>
            <Typography variant="caption" sx={{ opacity: 0.6 }}>Waiting for market triggers...</Typography>
            
            {dataStatus && dataStatus.percent < 100 && (
                <Box width="100%" maxWidth={200} mt={3}>
                    <Box display="flex" justifyContent="space-between" mb={0.5}>
                        <Typography variant="caption" sx={{ fontSize: '0.65rem' }}>DATA TRAINING</Typography>
                        <Typography variant="caption" sx={{ fontSize: '0.65rem' }}>{Math.round(dataStatus.percent)}%</Typography>
                    </Box>
                    <LinearProgress variant="determinate" value={dataStatus.percent} sx={{ height: 2, borderRadius: 2 }} />
                </Box>
            )}
        </Box>
      );
  }

  // 2. SIGNAL ROW RENDERER
  const renderSignal = (signal, index) => {
      const { color, icon } = getSignalMeta(signal.signal);
      const paletteColor = theme.palette[color]; // Safe access now

      return (
        <SignalRow key={`${signal.symbol}-${index}`}>
            {/* Left: Icon & Symbol */}
            <Box display="flex" alignItems="center" gap={2}>
                <Avatar 
                    variant="rounded" 
                    sx={{ 
                        width: 32, height: 32, 
                        bgcolor: alpha(paletteColor.main, 0.1), 
                        color: paletteColor.main,
                        border: `1px solid ${alpha(paletteColor.main, 0.2)}`
                    }}
                >
                    {icon}
                </Avatar>
                <Box>
                    <Box display="flex" alignItems="center" gap={1}>
                        <Typography variant="body2" fontWeight="bold">
                            {signal.symbol.replace('USDT', '')}
                        </Typography>
                        {signal.isNew && (
                            <Chip label="NEW" size="small" color="primary" sx={{ height: 16, fontSize: '0.6rem' }} />
                        )}
                    </Box>
                    <MonoText>
                        {new Date(signal.timestamp).toLocaleTimeString([], { hour12: false })}
                    </MonoText>
                </Box>
            </Box>
            
            {/* Right: Type & Strength */}
            <Box textAlign="right">
                <Chip 
                    label={signal.signal?.split('_')[0] || 'HOLD'} 
                    size="small" 
                    sx={{ 
                        height: 20, 
                        fontSize: '0.7rem', 
                        fontWeight: 'bold',
                        bgcolor: alpha(paletteColor.main, 0.1),
                        color: paletteColor.main,
                        border: `1px solid ${alpha(paletteColor.main, 0.2)}`,
                        mb: 0.5
                    }}
                />
                <Box display="flex" alignItems="center" justifyContent="flex-end" gap={0.5}>
                    <AutoGraph sx={{ fontSize: 12, opacity: 0.5 }} />
                    <MonoText color="text.primary">
                        ADX:{signal.strength?.toFixed(0) || '0'}
                    </MonoText>
                </Box>
            </Box>
        </SignalRow>
      );
  };

  // 3. MAIN CONTAINER
  return (
    <Box height="100%" display="flex" flexDirection="column">
        {/* Header (Only if not in compact tab mode, though currently compact is default usage) */}
        {!compact && (
             <Box p={2} borderBottom={1} borderColor="divider" display="flex" justifyContent="space-between" alignItems="center">
                <Box display="flex" alignItems="center" gap={1}>
                    <Radar color="primary" fontSize="small" />
                    <Typography variant="subtitle2" fontWeight="bold">SIGNALS FEED</Typography>
                </Box>
                <Chip label={`${signals.length} ACTIVE`} size="small" color="primary" variant="outlined" />
             </Box>
        )}

        <Stack spacing={0} sx={{ flexGrow: 1, overflowY: 'auto' }}>
            {signals.map((signal, index) => renderSignal(signal, index))}
        </Stack>
    </Box>
  );
};

export default TradingSignals;