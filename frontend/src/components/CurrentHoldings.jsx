// frontend/src/components/CurrentHoldings.jsx - ADDED FORCE SELL
import React, { useMemo, useState } from 'react';
import {
  Box, Paper, Typography, Card, CardContent, Chip, 
  IconButton, Tooltip, useTheme, alpha, Grid, Divider, Button, CircularProgress
} from '@mui/material';
import { AccountBalance, Info, Warning } from '@mui/icons-material';
import { apiCall } from '../config/api'; // Import generic API caller

const CurrentHoldings = ({ account, prices, portfolio, systemStatus }) => {
  const theme = useTheme();

  // Determine active assets from config + USDT
  const TRADING_ASSETS = useMemo(() => {
      const configAssets = systemStatus?.config?.assets || [];
      const cleanedAssets = configAssets.map(a => a.replace('USDT', ''));
      return ['USDT', ...new Set(cleanedAssets)];
  }, [systemStatus]);

  // Helpers
  const formatCurrency = (val) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);
  const formatCrypto = (val) => parseFloat(val || 0).toFixed(4);
  
  const calculateRealValue = (balance) => {
      if (balance.asset === 'USDT') return parseFloat(balance.total);
      const p = prices[`${balance.asset}USDT`]?.price || 0;
      return parseFloat(balance.total) * p;
  };

  // --- 1. BOT POSITION ROW (Active Trades) ---
  const PositionRow = ({ position }) => {
      const asset = position.symbol.replace('USDT', '');
      const pnl = position.unrealizedPnL || 0;
      const isPositive = pnl >= 0;
      const curPrice = prices[position.symbol]?.price || 0;
      const [closing, setClosing] = useState(false);

      const handleForceClose = async () => {
          if (!window.confirm(`⚠️ FORCE SELL ${asset}?\nThis will immediately sell the position at market price.`)) return;
          setClosing(true);
          try {
              // Call the new route we created
              await apiCall(`/api/trading/close/${position.id || position.trade_id}`, { method: 'POST' });
              // The UI will update automatically via the socket 'portfolioUpdated' event
          } catch (e) {
              alert(`Close Failed: ${e.message}`);
              setClosing(false);
          }
      };

      return (
        <Card variant="outlined" sx={{ mb: 1.5, bgcolor: alpha(theme.palette.background.paper, 0.4) }}>
            <CardContent sx={{ p: '12px !important' }}>
                {/* Header: Asset + Qty + PnL */}
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                    <Box display="flex" alignItems="center" gap={1.5}>
                        <Chip label={asset} color={isPositive ? "success" : "default"} size="small" sx={{ fontWeight: 'bold' }} />
                        <Typography variant="body2" fontWeight="bold">{formatCrypto(position.quantity)} units</Typography>
                    </Box>
                    <Box textAlign="right">
                        <Typography variant="body2" fontWeight="bold" sx={{ color: isPositive ? theme.palette.success.main : theme.palette.error.main }}>
                            {isPositive ? '+' : ''}{formatCurrency(pnl)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">Unrealized</Typography>
                    </Box>
                </Box>
                
                <Divider sx={{ my: 1, borderColor: alpha(theme.palette.divider, 0.1) }} />
                
                {/* Data Grid */}
                <Grid container spacing={1} alignItems="center">
                    <Grid item xs={3}>
                        <Typography variant="caption" color="text.secondary" display="block">Entry</Typography>
                        <Typography variant="caption" fontWeight="bold">{formatCurrency(position.price)}</Typography>
                    </Grid>
                    <Grid item xs={3} textAlign="center">
                        <Typography variant="caption" color="text.secondary" display="block">Current</Typography>
                        <Typography variant="caption" fontWeight="bold">{formatCurrency(curPrice)}</Typography>
                    </Grid>
                    <Grid item xs={3} textAlign="center">
                        <Typography variant="caption" color="text.secondary" display="block">Stop Loss</Typography>
                        <Typography variant="caption" fontWeight="bold" color="error.main">
                            {position.stopLoss ? formatCurrency(position.stopLoss) : '---'}
                        </Typography>
                    </Grid>
                    {/* NEW: FORCE EXIT BUTTON */}
                    <Grid item xs={3} textAlign="right">
                        <Button 
                            variant="contained" 
                            color="error" 
                            size="small" 
                            onClick={handleForceClose}
                            disabled={closing}
                            sx={{ minWidth: 30, px: 1, py: 0.5, fontSize: '0.65rem', fontWeight: 'bold' }}
                        >
                            {closing ? <CircularProgress size={14} color="inherit" /> : 'EXIT'}
                        </Button>
                    </Grid>
                </Grid>
            </CardContent>
        </Card>
      );
  };

  // --- 2. WALLET BALANCE ROW (Binance Funds) ---
  const BalanceRow = ({ balance }) => {
      const value = calculateRealValue(balance);
      const isUsdt = balance.asset === 'USDT';

      return (
        <Card variant="outlined" sx={{ mb: 1.5, bgcolor: alpha(theme.palette.success.main, 0.05), borderColor: alpha(theme.palette.success.main, 0.2) }}>
            <CardContent sx={{ p: '12px !important' }}>
                <Box display="flex" justifyContent="space-between" alignItems="center">
                    <Box display="flex" alignItems="center" gap={1.5}>
                         <Chip label={balance.asset} color={isUsdt ? "success" : "default"} size="small" sx={{ fontWeight: 'bold' }} />
                        <Typography variant="body2" fontWeight="bold">{formatCurrency(value)}</Typography>
                    </Box>
                    <Typography variant="body2" fontWeight="bold" color="text.secondary">{formatCrypto(balance.total)}</Typography>
                </Box>
            </CardContent>
        </Card>
      );
  };

  return (
    <Paper sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column', bgcolor: alpha(theme.palette.background.paper, 0.6) }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h6" fontWeight="bold">Active Assets</Typography>
        <Tooltip title="Shows both active bot positions and wallet balances"><IconButton size="small"><Info fontSize="small" /></IconButton></Tooltip>
      </Box>

      <Box sx={{ flexGrow: 1, overflowY: 'auto' }}>
         <Typography variant="overline" color="text.secondary" sx={{ mb: 1, display: 'block', letterSpacing: 1, fontWeight: 'bold' }}>
            BOT POSITIONS
         </Typography>
         
         {portfolio?.positions?.map(p => <PositionRow key={p.symbol} position={p} />)}
         
         {!portfolio?.positions?.length && (
            <Typography variant="caption" display="block" sx={{ mb: 3, fontStyle: 'italic', color: 'text.secondary' }}>
                No active trades running.
            </Typography>
         )}

         <Divider sx={{ my: 2 }} />

         <Typography variant="overline" color="text.secondary" sx={{ mb: 1, display: 'block', letterSpacing: 1, fontWeight: 'bold' }}>
            WALLET BALANCES
         </Typography>
         
         {account?.balances?.filter(b => TRADING_ASSETS.includes(b.asset) && parseFloat(b.total) > 0).map(b => (
             <BalanceRow key={b.asset} balance={b} />
         ))}
      </Box>
    </Paper>
  );
};

export default CurrentHoldings;