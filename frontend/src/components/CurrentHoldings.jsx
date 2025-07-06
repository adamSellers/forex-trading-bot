// frontend/src/components/CurrentHoldings.jsx - Enhanced with Clear Tabs
import React, { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Card,
  CardContent,
  Grid,
  Chip,
  Divider,
  Tabs,
  Tab,
  Alert,
  IconButton,
  Tooltip
} from '@mui/material';
import {
  AccountBalance,
  Psychology,
  CompareArrows,
  Info,
  TrendingUp,
  Wallet,
  ShowChart
} from '@mui/icons-material';

function TabPanel({ children, value, index, ...other }) {
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`portfolio-tabpanel-${index}`}
      aria-labelledby={`portfolio-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ pt: 2 }}>{children}</Box>}
    </div>
  );
}

const CurrentHoldings = ({ account, prices, portfolio }) => {
  const [tabValue, setTabValue] = useState(0);
  
  // Define our trading assets
  const TRADING_ASSETS = ['USDT', 'BTC', 'ETH', 'BNB', 'DOGE'];

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(value || 0);
  };

  const formatCrypto = (value, decimals = 6) => {
    if (value === 0) return '0';
    return parseFloat(value).toFixed(decimals);
  };

  const formatPercent = (value) => {
    return `${(value || 0).toFixed(2)}%`;
  };

  const calculateAssetValue = (balance, prices) => {
    if (!balance || !prices) return 0;
    if (balance.asset === 'USDT') return balance.total;
    const symbol = `${balance.asset}USDT`;
    const price = prices[symbol]?.price || 0;
    return balance.total * price;
  };

  // Calculate Real Portfolio Value
  const getRealPortfolioValue = () => {
    if (!account?.balances || !prices) return 0;
    return account.balances
      .filter(balance => TRADING_ASSETS.includes(balance.asset))
      .reduce((total, balance) => total + calculateAssetValue(balance, prices), 0);
  };

  // Get Paper Trading Positions
  const getPaperPositions = () => {
    if (!portfolio?.positions) return [];
    return portfolio.positions;
  };

  // Calculate Paper Portfolio Value
  const getPaperPortfolioValue = () => {
    const paperUSDT = portfolio?.usdtBalance || 0;
    const paperCrypto = portfolio?.cryptoValue || 0;
    return paperUSDT + paperCrypto;
  };

  // Paper Portfolio Asset Card
  const PaperAssetCard = ({ asset, position, usdtBalance }) => {
    if (asset === 'USDT') {
      return (
        <Card variant="outlined" sx={{ mb: 1.5, backgroundColor: 'rgba(255, 193, 7, 0.05)' }}>
          <CardContent sx={{ py: 1.5 }}>
            <Box display="flex" alignItems="center" gap={2}>
              {/* Column 1: Asset Name */}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box display="flex" alignItems="center" gap={1}>
                  <Psychology color="warning" fontSize="small" />
                  <Typography variant="subtitle1" fontWeight="bold">
                    USDT
                  </Typography>
                  <Chip size="small" label="Virtual Cash" color="warning" variant="outlined" />
                </Box>
              </Box>
              {/* Column 2: Balance */}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="h6" color="warning.main" fontWeight="bold">
                  {formatCrypto(usdtBalance, 2)}
                </Typography>
                <Typography variant="caption" color="textSecondary">
                  Available for Trading
                </Typography>
              </Box>
              {/* Column 3: USD Value */}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" color="warning.main">
                  {formatCurrency(usdtBalance)}
                </Typography>
                <Typography variant="caption" color="textSecondary">
                  USD Value
                </Typography>
              </Box>
              {/* Column 4: Allocation */}
              <Box sx={{ flex: 1, minWidth: 0, textAlign: 'right' }}>
                <Typography variant="body2" color="primary.main">
                  {((usdtBalance / getPaperPortfolioValue()) * 100).toFixed(1)}%
                </Typography>
                <Typography variant="caption" color="textSecondary">
                  Portfolio Allocation
                </Typography>
              </Box>
            </Box>
          </CardContent>
        </Card>
      );
    }

    if (!position) return null;

    const currentPrice = prices[position.symbol]?.price || 0;
    const pnlColor = (position.unrealizedPnL || 0) >= 0 ? 'success.main' : 'error.main';

    return (
      <Card variant="outlined" sx={{ mb: 1.5, backgroundColor: 'rgba(255, 193, 7, 0.05)' }}>
        <CardContent sx={{ py: 1.5 }}>
          <Box display="flex" alignItems="center" gap={1}>
            {/* Column 1: Asset Name */}
            <Box sx={{ flexBasis: '25%', minWidth: 0 }}>
              <Box display="flex" alignItems="center" gap={1}>
                <Psychology color="warning" fontSize="small" />
                <Typography variant="subtitle1" fontWeight="bold">
                  {asset}
                </Typography>
                <Chip size="small" label="Virtual Position" color="warning" variant="outlined" />
              </Box>
            </Box>
            {/* Column 2: Quantity */}
            <Box sx={{ flexBasis: '16.67%', minWidth: 0 }}>
              <Typography variant="body2" fontWeight="500">
                {formatCrypto(position.quantity, asset === 'USDT' ? 2 : 6)}
              </Typography>
              <Typography variant="caption" color="textSecondary">
                Quantity
              </Typography>
            </Box>
            {/* Column 3: Current Value */}
            <Box sx={{ flexBasis: '16.67%', minWidth: 0 }}>
              <Typography variant="body2" color="warning.main">
                {formatCurrency(position.currentValue || 0)}
              </Typography>
              <Typography variant="caption" color="textSecondary">
                Current Value
              </Typography>
            </Box>
            {/* Column 4: P&L */}
            <Box sx={{ flexBasis: '16.67%', minWidth: 0 }}>
              <Typography variant="body2" color={pnlColor} fontWeight="bold">
                {(position.unrealizedPnL || 0) >= 0 ? '+' : ''}
                {formatCurrency(position.unrealizedPnL || 0)}
              </Typography>
              <Typography variant="caption" color="textSecondary">
                Unrealized P&L
              </Typography>
            </Box>
            {/* Column 5: Entry */}
            <Box sx={{ flexBasis: '12.5%', minWidth: 0 }}>
              <Typography variant="body2">
                ${position.avgPrice?.toFixed(2) || 'N/A'}
              </Typography>
              <Typography variant="caption" color="textSecondary">
                Entry
              </Typography>
            </Box>
            {/* Column 6: Current */}
            <Box sx={{ flexBasis: '12.5%', minWidth: 0, textAlign: 'right' }}>
              <Typography variant="body2">
                ${currentPrice.toFixed(2)}
              </Typography>
              <Typography variant="caption" color="textSecondary">
                Current
              </Typography>
            </Box>
          </Box>
          
          {/* Position Details */}
          <Box mt={1} p={1} sx={{ backgroundColor: 'rgba(255, 193, 7, 0.1)', borderRadius: 1, display: 'flex', gap: 2 }}>
            <Box sx={{ flex: 1 }}>
                <Typography variant="caption" color="textSecondary">Stop Loss:</Typography>
                <Typography variant="caption" sx={{ ml: 0.5 }}>
                  ${position.stopLoss?.toFixed(2) || 'N/A'}
                </Typography>
            </Box>
            <Box sx={{ flex: 1 }}>
                <Typography variant="caption" color="textSecondary">Duration:</Typography>
                <Typography variant="caption" sx={{ ml: 0.5 }}>
                  {position.entryTime ? 
                    Math.floor((Date.now() - position.entryTime) / (1000 * 60 * 60)) + 'h' : 
                    'N/A'
                  }
                </Typography>
            </Box>
            <Box sx={{ flex: 1 }}>
                <Typography variant="caption" color="textSecondary">Entry Cost:</Typography>
                <Typography variant="caption" sx={{ ml: 0.5 }}>
                  {formatCurrency(position.entryCost || 0)}
                </Typography>
            </Box>
            <Box sx={{ flex: 1, textAlign: 'right' }}>
                <Typography variant="caption" color="textSecondary">Allocation:</Typography>
                <Typography variant="caption" sx={{ ml: 0.5 }}>
                  {((position.currentValue || 0) / getPaperPortfolioValue() * 100).toFixed(1)}%
                </Typography>
            </Box>
          </Box>
        </CardContent>
      </Card>
    );
  };

  // Real Holdings Asset Card
  const RealAssetCard = ({ balance }) => {
    // Always show the USDT card, but only show other assets if they have a balance.
    if (!balance || (balance.asset !== 'USDT' && balance.total === 0)) {
      return null;
    }

    const assetValue = calculateAssetValue(balance, prices);
    const totalPortfolioValue = getRealPortfolioValue();
    const allocation = totalPortfolioValue > 0 ? (assetValue / totalPortfolioValue) * 100 : 0;

    return (
      <Card variant="outlined" sx={{ mb: 1.5, backgroundColor: 'rgba(76, 175, 80, 0.05)' }}>
        <CardContent sx={{ py: 1.5 }}>
          <Box display="flex" alignItems="center" gap={2}>
            {/* Column 1: Asset Name */}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box display="flex" alignItems="center" gap={1}>
                <AccountBalance color="success" fontSize="small" />
                <Typography variant="subtitle1" fontWeight="bold">
                  {balance.asset}
                </Typography>
                <Chip size="small" label="Real Holdings" color="success" variant="outlined" />
              </Box>
            </Box>
            {/* Column 2: Balance */}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="h6" color="success.main" fontWeight="bold">
                {formatCrypto(balance.total, balance.asset === 'USDT' ? 2 : 6)}
              </Typography>
              <Typography variant="caption" color="textSecondary">
                Total Balance
              </Typography>
            </Box>
            {/* Column 3: USD Value */}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" color="success.main">
                {formatCurrency(assetValue)}
              </Typography>
              <Typography variant="caption" color="textSecondary">
                USD Value
              </Typography>
            </Box>
            {/* Column 4: Allocation */}
            <Box sx={{ flex: 1, minWidth: 0, textAlign: 'right' }}>
              <Typography variant="body2" color="primary.main">
                {formatPercent(allocation)}
              </Typography>
              <Typography variant="caption" color="textSecondary">
                Portfolio %
              </Typography>
            </Box>
          </Box>
          
          {balance.asset !== 'USDT' && (
            <Box mt={1} p={1} sx={{ backgroundColor: 'rgba(76, 175, 80, 0.1)', borderRadius: 1, display: 'flex', gap: 2 }}>
              <Box sx={{ flex: 1 }}>
                  <Typography variant="caption" color="textSecondary">Available:</Typography>
                  <Typography variant="caption" sx={{ ml: 0.5 }}>
                    {formatCrypto(balance.free, balance.asset === 'USDT' ? 2 : 6)}
                  </Typography>
              </Box>
              <Box sx={{ flex: 1 }}>
                  <Typography variant="caption" color="textSecondary">Locked:</Typography>
                  <Typography variant="caption" sx={{ ml: 0.5 }}>
                    {formatCrypto(balance.locked, balance.asset === 'USDT' ? 2 : 6)}
                  </Typography>
              </Box>
              <Box sx={{ flex: 1, textAlign: 'right' }}>
                  <Typography variant="caption" color="textSecondary">Current Price:</Typography>
                  <Typography variant="caption" sx={{ ml: 0.5 }}>
                    ${prices[`${balance.asset}USDT`]?.price?.toFixed(2) || 'N/A'}
                  </Typography>
              </Box>
            </Box>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <Paper sx={{ p: 3, height: '100%', width: '100%', boxSizing: 'border-box' }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h6">
          Portfolio Holdings
        </Typography>
        <Tooltip title="This shows both your simulated paper trading positions and real Binance account holdings">
          <IconButton size="small">
            <Info fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Tab Navigation */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs value={tabValue} onChange={(e, newValue) => setTabValue(newValue)}>
          <Tab 
            icon={<Psychology />} 
            label="Paper Trading" 
            id="portfolio-tab-0"
            sx={{ color: 'warning.main' }}
          />
          <Tab 
            icon={<AccountBalance />} 
            label="Real Holdings" 
            id="portfolio-tab-1"
            sx={{ color: 'success.main' }}
          />
          <Tab 
            icon={<CompareArrows />} 
            label="Combined View" 
            id="portfolio-tab-2"
          />
        </Tabs>
      </Box>

      {/* Paper Trading Tab */}
      <TabPanel value={tabValue} index={0}>
        <Alert severity="warning" sx={{ mb: 2 }}>
          <Box display="flex" alignItems="center" gap={1}>
            <Psychology />
            <Typography variant="body2">
              <strong>Paper Trading Portfolio</strong> - These are simulated positions using virtual $5,000 USDT. No real money is at risk.
            </Typography>
          </Box>
        </Alert>

        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid xs={4}>
            <Card variant="outlined" sx={{ textAlign: 'center', py: 1, backgroundColor: 'rgba(255, 193, 7, 0.1)' }}>
              <Typography variant="caption" color="textSecondary">Total Virtual Portfolio</Typography>
              <Typography variant="h6" color="warning.main">
                {formatCurrency(getPaperPortfolioValue())}
              </Typography>
            </Card>
          </Grid>
          <Grid xs={4}>
            <Card variant="outlined" sx={{ textAlign: 'center', py: 1, backgroundColor: 'rgba(255, 193, 7, 0.1)' }}>
              <Typography variant="caption" color="textSecondary">Virtual P&L</Typography>
              <Typography variant="h6" color={(portfolio?.totalPnL || 0) >= 0 ? 'success.main' : 'error.main'}>
                {(portfolio?.totalPnL || 0) >= 0 ? '+' : ''}{formatCurrency(portfolio?.totalPnL || 0)}
              </Typography>
            </Card>
          </Grid>
          <Grid xs={4}>
            <Card variant="outlined" sx={{ textAlign: 'center', py: 1, backgroundColor: 'rgba(255, 193, 7, 0.1)' }}>
              <Typography variant="caption" color="textSecondary">Virtual Positions</Typography>
              <Typography variant="h6" color="warning.main">
                {getPaperPositions().length}
              </Typography>
            </Card>
          </Grid>
        </Grid>

        <Box sx={{ maxHeight: 400, overflow: 'auto' }}>
          {/* USDT Balance */}
          <PaperAssetCard asset="USDT" usdtBalance={portfolio?.usdtBalance || 0} />
          
          {/* Paper Positions */}
          {getPaperPositions().map(position => {
            const asset = position.symbol.replace('USDT', '');
            return (
              <PaperAssetCard 
                key={position.symbol} 
                asset={asset} 
                position={position} 
              />
            );
          })}

          {getPaperPositions().length === 0 && (
            <Box textAlign="center" py={4}>
              <Psychology sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
              <Typography variant="body2" color="textSecondary">
                No virtual positions currently open
              </Typography>
              <Typography variant="caption" color="textSecondary">
                Virtual trades will appear here when the paper trading engine executes signals
              </Typography>
            </Box>
          )}
        </Box>
      </TabPanel>

      {/* Real Holdings Tab */}
      <TabPanel value={tabValue} index={1}>
        <Alert severity="success" sx={{ mb: 2 }}>
          <Box display="flex" alignItems="center" gap={1}>
            <AccountBalance />
            <Typography variant="body2">
              <strong>Real Binance Account</strong> - These are your actual cryptocurrency holdings. Values are live from Binance API.
            </Typography>
          </Box>
        </Alert>

        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid xs={4}>
            <Card variant="outlined" sx={{ textAlign: 'center', py: 1, backgroundColor: 'rgba(76, 175, 80, 0.1)' }}>
              <Typography variant="caption" color="textSecondary">Total Real Portfolio</Typography>
              <Typography variant="h6" color="success.main">
                {formatCurrency(getRealPortfolioValue())}
              </Typography>
            </Card>
          </Grid>
          <Grid xs={4}>
            <Card variant="outlined" sx={{ textAlign: 'center', py: 1, backgroundColor: 'rgba(76, 175, 80, 0.1)' }}>
              <Typography variant="caption" color="textSecondary">Account Type</Typography>
              <Typography variant="h6" color="success.main">
                {account?.accountType || 'SPOT'}
              </Typography>
            </Card>
          </Grid>
          <Grid xs={4}>
            <Card variant="outlined" sx={{ textAlign: 'center', py: 1, backgroundColor: 'rgba(76, 175, 80, 0.1)' }}>
              <Typography variant="caption" color="textSecondary">Assets Held</Typography>
              <Typography variant="h6" color="success.main">
                {account?.balances?.filter(b => b.total > 0).length || 0}
              </Typography>
            </Card>
          </Grid>
        </Grid>

        <Box sx={{ maxHeight: 400, overflow: 'auto' }}>
          {account?.balances?.filter(balance => 
            TRADING_ASSETS.includes(balance.asset) && (balance.total > 0 || balance.asset === 'USDT')
          ).sort((a, b) => a.asset === 'USDT' ? -1 : b.asset === 'USDT' ? 1 : a.asset.localeCompare(b.asset)) // Keep USDT at the top
          .map(balance => (
            <RealAssetCard key={balance.asset} balance={balance} />
          ))}

          {(!account?.balances || account.balances.filter(b => TRADING_ASSETS.includes(b.asset) && b.total > 0).length === 0) && (
            <Box textAlign="center" py={4}>
              <AccountBalance sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
              <Typography variant="body2" color="textSecondary">
                No holdings found in tracked assets
              </Typography>
              <Typography variant="caption" color="textSecondary">
                Tracking: {TRADING_ASSETS.join(', ')}
              </Typography>
            </Box>
          )}
        </Box>
      </TabPanel>

      {/* Combined View Tab (existing functionality) */}
      <TabPanel value={tabValue} index={2}>
        <Alert severity="info" sx={{ mb: 2 }}>
          <Box display="flex" alignItems="center" gap={1}>
            <CompareArrows />
            <Typography variant="body2">
              <strong>Combined Portfolio View</strong> - Side-by-side comparison of paper trading performance vs real holdings.
            </Typography>
          </Box>
        </Alert>

        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid xs={4}>
            <Card variant="outlined" sx={{ textAlign: 'center', py: 1 }}>
              <Typography variant="caption" color="textSecondary">Paper Trading</Typography>
              <Typography variant="h6" color="warning.main">
                {formatCurrency(getPaperPortfolioValue())}
              </Typography>
            </Card>
          </Grid>
          <Grid xs={4}>
            <Card variant="outlined" sx={{ textAlign: 'center', py: 1 }}>
              <Typography variant="caption" color="textSecondary">Real Holdings</Typography>
              <Typography variant="h6" color="success.main">
                {formatCurrency(getRealPortfolioValue())}
              </Typography>
            </Card>
          </Grid>
          <Grid xs={4}>
            <Card variant="outlined" sx={{ textAlign: 'center', py: 1 }}>
              <Typography variant="caption" color="textSecondary">Combined Total</Typography>
              <Typography variant="h6" color="primary.main">
                {formatCurrency(getPaperPortfolioValue() + getRealPortfolioValue())}
              </Typography>
            </Card>
          </Grid>
        </Grid>

        {/* Combined asset view would go here - keeping existing logic */}
        <Typography variant="body2" color="textSecondary" textAlign="center" py={2}>
          Combined asset-by-asset comparison view
        </Typography>
      </TabPanel>

      {/* Footer Info */}
      <Box mt={2} p={1} sx={{ backgroundColor: 'action.hover', borderRadius: 1 }}>
        <Typography variant="caption" color="textSecondary">
          📊 <strong>Data Sources:</strong> Live market prices from Binance API • 
          Paper positions from virtual trading engine • 
          Real balances from Binance account • 
          <strong>Last Update:</strong> {new Date().toLocaleTimeString()}
        </Typography>
      </Box>
    </Paper>
  );
};

export default CurrentHoldings;