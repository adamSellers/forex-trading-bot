// frontend/src/components/CurrentHoldings.jsx - LIVE ONLY
import React, { useMemo } from 'react';
import {
  Box, Paper, Typography, Card, CardContent, Chip, 
  IconButton, Tooltip, useTheme, alpha, Grid, Divider
} from '@mui/material';
import { AccountBalance, Info, Lock, LockOpen } from '@mui/icons-material';

const CurrentHoldings = ({ account, prices, portfolio, systemStatus }) => {
  const theme = useTheme();

  const TRADING_ASSETS = useMemo(() => {
      const configAssets = systemStatus?.config?.assets || [];
      const cleanedAssets = configAssets.map(a => a.replace('USDT', ''));
      return ['USDT', ...new Set(cleanedAssets)];
  }, [systemStatus]);

  const formatCurrency = (val) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);
  const formatCrypto = (val) => parseFloat(val || 0).toFixed(4);
  
  const calculateRealValue = (balance) => {
      if (balance.asset === 'USDT') return parseFloat(balance.total);
      const p = prices[`${balance.asset}USDT`]?.price || 0;
      return parseFloat(balance.total) * p;
  };

  const PositionRow = ({ position }) => {
      const asset = position.symbol.replace('USDT', '');
      const pnl = position.unrealizedPnL || 0;
      const isPositive = pnl >= 0;
      const curPrice = prices[position.symbol]?.price || 0;

      return (
        <Card variant="outlined" sx={{ mb: 1.5, bgcolor: alpha(theme.palette.background.paper, 0.4) }}>
            <CardContent sx={{ p: '12px !important' }}>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                    <Box display="flex" alignItems="center" gap={1.5}>
                        <Chip label={asset} color="error" size="small" sx={{ fontWeight: 'bold' }} />
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
                <Grid container spacing={1}>
                    <Grid item xs={6}>
                        <Typography variant="caption" color="text.secondary">Entry: </Typography>
                        <Typography variant="caption" fontWeight="bold">{formatCurrency(position.avgPrice)}</Typography>
                    </Grid>
                    <Grid item xs={6} textAlign="right">
                        <Typography variant="caption" color="text.secondary">Current: </Typography>
                        <Typography variant="caption" fontWeight="bold">{formatCurrency(curPrice)}</Typography>
                    </Grid>
                </Grid>
            </CardContent>
        </Card>
      );
  };

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
         <Typography variant="overline" color="text.secondary" sx={{ mb: 1, display: 'block' }}>BOT POSITIONS</Typography>
         {portfolio?.positions?.map(p => <PositionRow key={p.symbol} position={p} />)}
         {!portfolio?.positions?.length && <Typography variant="caption" display="block" sx={{ mb: 2, fontStyle: 'italic' }}>No active trades.</Typography>}

         <Divider sx={{ my: 2 }} />

         <Typography variant="overline" color="text.secondary" sx={{ mb: 1, display: 'block' }}>WALLET BALANCES</Typography>
         {account?.balances?.filter(b => TRADING_ASSETS.includes(b.asset) && parseFloat(b.total) > 0).map(b => (
             <BalanceRow key={b.asset} balance={b} />
         ))}
      </Box>
    </Paper>
  );
};

export default CurrentHoldings;