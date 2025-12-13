// frontend/src/components/CurrentHoldings.jsx - FINAL FIX
import React, { useState } from 'react';
import {
  Box, Paper, Typography, Card, CardContent, Chip, Tabs, Tab,
  IconButton, Tooltip, Stack, LinearProgress, useTheme, alpha, Grid, Divider, Alert
} from '@mui/material';
import {
  AccountBalance, MonetizationOn, Psychology, CompareArrows, Info,
  Lock, LockOpen
} from '@mui/icons-material';

function TabPanel({ children, value, index }) {
  return <div hidden={value !== index}>{value === index && <Box sx={{ pt: 2 }}>{children}</Box>}</div>;
}

const CurrentHoldings = ({ account, prices, portfolio, systemStatus }) => {
  const theme = useTheme();
  const isLiveMode = systemStatus?.config?.tradingMode === 'live';
  const [tabValue, setTabValue] = useState(isLiveMode ? 1 : 0);
  const TRADING_ASSETS = ['USDT', 'BTC', 'ETH', 'BNB', 'DOGE', 'TRUMP'];

  // --- HELPERS ---
  const formatCurrency = (val) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);
  const formatCrypto = (val) => parseFloat(val || 0).toFixed(4);
  const getPaperValue = () => (portfolio?.usdtBalance || 0) + (portfolio?.cryptoValue || 0);
  
  const calculateRealValue = (balance) => {
      if (balance.asset === 'USDT') return balance.total;
      const p = prices[`${balance.asset}USDT`]?.price || 0;
      return balance.total * p;
  };
  
  const getRealTotal = () => {
      if (!account?.balances) return 0;
      return account.balances.reduce((acc, b) => {
          if (TRADING_ASSETS.includes(b.asset)) return acc + calculateRealValue(b);
          return acc;
      }, 0);
  };

  // --- SUB-COMPONENTS ---

  // 1. Detailed Position Row (For Bot/Paper Trading)
  const PositionRow = ({ position }) => {
      const asset = position.symbol.replace('USDT', '');
      const pnl = position.unrealizedPnL || 0;
      const isPositive = pnl >= 0;
      const pnlColor = isPositive ? theme.palette.success.main : theme.palette.error.main;
      const curPrice = prices[position.symbol]?.price || 0;
      const durationHours = position.entryTime ? ((Date.now() - position.entryTime) / (1000 * 60 * 60)).toFixed(1) : 0;

      return (
        <Card variant="outlined" sx={{ mb: 1.5, bgcolor: alpha(theme.palette.background.paper, 0.4) }}>
            <CardContent sx={{ p: '12px !important' }}>
                {/* Top Row: Main Info */}
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                    <Box display="flex" alignItems="center" gap={1.5}>
                        <Chip 
                            label={asset} 
                            color={isLiveMode ? "error" : "warning"} 
                            size="small" 
                            sx={{ fontWeight: 'bold' }} 
                        />
                        <Typography variant="body2" fontWeight="bold">
                            {formatCrypto(position.quantity)} units
                        </Typography>
                        <Chip 
                            label={`${durationHours}h`} 
                            size="small" 
                            variant="outlined" 
                            sx={{ height: 20, fontSize: '0.7rem' }} 
                        />
                    </Box>
                    <Box textAlign="right">
                        <Typography variant="body2" fontWeight="bold" sx={{ color: pnlColor }}>
                            {isPositive ? '+' : ''}{formatCurrency(pnl)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                            Unrealized PnL
                        </Typography>
                    </Box>
                </Box>

                <Divider sx={{ my: 1, borderColor: alpha(theme.palette.divider, 0.1) }} />

                {/* Bottom Row: Detailed Stats */}
                <Grid container spacing={1}>
                    <Grid item xs={3}>
                        <Typography variant="caption" color="text.secondary" display="block">Entry</Typography>
                        <Typography variant="caption" fontWeight="bold">{formatCurrency(position.avgPrice)}</Typography>
                    </Grid>
                    <Grid item xs={3}>
                        <Typography variant="caption" color="text.secondary" display="block">Current</Typography>
                        <Typography variant="caption" fontWeight="bold">{formatCurrency(curPrice)}</Typography>
                    </Grid>
                    <Grid item xs={3}>
                        <Typography variant="caption" color="text.secondary" display="block">Stop Loss</Typography>
                        <Typography variant="caption" color="error.main" fontWeight="bold">
                            {position.stopLoss ? formatCurrency(position.stopLoss) : '---'}
                        </Typography>
                    </Grid>
                    <Grid item xs={3} textAlign="right">
                        <Typography variant="caption" color="text.secondary" display="block">Trailing</Typography>
                        <Typography variant="caption" color="info.main" fontWeight="bold">
                            {position.trailingStop ? formatCurrency(position.trailingStop) : '---'}
                        </Typography>
                    </Grid>
                </Grid>
            </CardContent>
        </Card>
      );
  };

  // 2. Real Balance Row (For Binance Account)
  const BalanceRow = ({ balance }) => {
      const value = calculateRealValue(balance);
      const isUsdt = balance.asset === 'USDT';

      return (
        <Card variant="outlined" sx={{ mb: 1.5, bgcolor: alpha(theme.palette.success.main, 0.05), borderColor: alpha(theme.palette.success.main, 0.2) }}>
            <CardContent sx={{ p: '12px !important' }}>
                <Box display="flex" justifyContent="space-between" alignItems="center">
                    <Box display="flex" alignItems="center" gap={1.5}>
                         <Chip 
                            label={balance.asset} 
                            color={isUsdt ? "success" : "default"} 
                            size="small" 
                            sx={{ fontWeight: 'bold' }} 
                        />
                        <Typography variant="body2" fontWeight="bold">
                            {formatCurrency(value)}
                        </Typography>
                    </Box>
                    <Typography variant="body2" fontWeight="bold" color="text.secondary">
                        {formatCrypto(balance.total)}
                    </Typography>
                </Box>

                {!isUsdt && (
                    <Box mt={1} display="flex" gap={2} fontSize="0.75rem" color="text.secondary">
                        <Box display="flex" alignItems="center" gap={0.5}>
                            <LockOpen fontSize="inherit" /> Free: {formatCrypto(balance.free)}
                        </Box>
                        <Box display="flex" alignItems="center" gap={0.5}>
                            <Lock fontSize="inherit" /> Locked: {formatCrypto(balance.locked)}
                        </Box>
                    </Box>
                )}
            </CardContent>
        </Card>
      );
  };

  return (
    <Paper sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column', bgcolor: alpha(theme.palette.background.paper, 0.6) }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
        <Typography variant="h6" fontWeight="bold">Holdings</Typography>
        <Tooltip title="Switch between Bot Portfolio and Real Binance Balances">
          <IconButton size="small"><Info fontSize="small" /></IconButton>
        </Tooltip>
      </Box>

      <Tabs 
        value={tabValue} 
        onChange={(e, v) => setTabValue(v)} 
        variant="fullWidth" 
        sx={{ minHeight: 40, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab iconPosition="start" icon={isLiveMode ? <MonetizationOn fontSize="small" /> : <Psychology fontSize="small" />} label="Bot" sx={{ minHeight: 40 }} />
        <Tab iconPosition="start" icon={<AccountBalance fontSize="small" />} label="Wallet" sx={{ minHeight: 40 }} />
        <Tab iconPosition="start" icon={<CompareArrows fontSize="small" />} label="Net Worth" sx={{ minHeight: 40 }} />
      </Tabs>

      <Box sx={{ flexGrow: 1, overflowY: 'auto', mt: 2 }}>
        
        {/* TAB 1: BOT PORTFOLIO */}
        <TabPanel value={tabValue} index={0}>
             {/* Summary Header */}
             <Box mb={2} p={1.5} borderRadius={1} bgcolor={alpha(isLiveMode ? theme.palette.error.main : theme.palette.warning.main, 0.1)}>
                 <Grid container spacing={1} textAlign="center">
                     <Grid item xs={6}>
                         <Typography variant="caption" color="text.secondary">Total Equity</Typography>
                         <Typography variant="subtitle1" fontWeight="bold" color={isLiveMode ? "error.main" : "warning.main"}>
                             {formatCurrency(getPaperValue())}
                         </Typography>
                     </Grid>
                     <Grid item xs={6}>
                         <Typography variant="caption" color="text.secondary">Open PnL</Typography>
                         <Typography variant="subtitle1" fontWeight="bold" color={(portfolio?.totalPnL || 0) >= 0 ? "success.main" : "error.main"}>
                             {(portfolio?.totalPnL || 0) >= 0 ? '+' : ''}{formatCurrency(portfolio?.totalPnL)}
                         </Typography>
                     </Grid>
                 </Grid>
             </Box>
             
             {/* Cash Row */}
             <Box display="flex" justifyContent="space-between" alignItems="center" p={1.5} mb={1.5} borderRadius={1} border={1} borderColor="divider">
                 <Box display="flex" alignItems="center" gap={1}>
                    <AccountBalance color="disabled" fontSize="small" />
                    <Typography variant="body2">Available Cash (USDT)</Typography>
                 </Box>
                 <Typography variant="body2" fontWeight="bold">{formatCurrency(portfolio?.usdtBalance)}</Typography>
             </Box>
             
             {/* Positions */}
             {portfolio?.positions?.map(p => (
                 <PositionRow key={p.symbol} position={p} />
             ))}

             {(!portfolio?.positions?.length) && (
                 <Typography align="center" py={4} color="text.secondary">No active positions.</Typography>
             )}
        </TabPanel>

        {/* TAB 2: BINANCE WALLET */}
        <TabPanel value={tabValue} index={1}>
             <Box mb={2} p={1.5} borderRadius={1} bgcolor={alpha(theme.palette.success.main, 0.1)}>
                 <Typography align="center" variant="caption" display="block" color="text.secondary">Binance Total Balance</Typography>
                 <Typography align="center" variant="h5" fontWeight="bold" color="success.main">
                     {formatCurrency(getRealTotal())}
                 </Typography>
             </Box>

             {account?.balances?.filter(b => TRADING_ASSETS.includes(b.asset) && (parseFloat(b.total) > 0 || b.asset === 'USDT')).map(b => (
                 <BalanceRow key={b.asset} balance={b} />
             ))}

             {(!account?.balances) && (
                 <Typography align="center" py={4} color="text.secondary">No balances found.</Typography>
             )}
        </TabPanel>

        {/* TAB 3: NET WORTH */}
        <TabPanel value={tabValue} index={2}>
            <Stack spacing={2} mt={2}>
                <Paper variant="outlined" sx={{ p: 3, textAlign: 'center', borderColor: theme.palette.primary.main }}>
                    <Typography color="text.secondary" gutterBottom>Combined Net Worth</Typography>
                    <Typography variant="h3" fontWeight="bold" color="primary.main">
                        {formatCurrency(getPaperValue() + getRealTotal())}
                    </Typography>
                </Paper>
                
                <Alert severity="info" variant="outlined">
                    <Typography variant="caption">
                        This combines your Bot&apos;s allocated capital (Real or Paper) with your unallocated Binance Wallet funds.
                    </Typography>
                </Alert>
            </Stack>
        </TabPanel>
      
      </Box>
    </Paper>
  );
};

export default CurrentHoldings;