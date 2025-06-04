// frontend/src/components/TradingDashboard.jsx
import React, { useState, useEffect } from 'react';
import {
  Box,
  Container,
  Grid,
  Paper,
  Typography,
  Switch,
  Button,
  Alert,
  Chip,
  Card,
  CardContent,
  IconButton,
  Divider,
  Select,
  MenuItem,
  FormControl,
  InputLabel
} from '@mui/material';
import {
  PlayArrow,
  Stop,
  Refresh,
  Settings,
  TrendingUp,
  TrendingDown,
  AccountBalance,
  ShowChart,
  Timeline
} from '@mui/icons-material';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { io } from 'socket.io-client';

const TradingDashboard = () => {
  const [socket, setSocket] = useState(null);
  const [systemStatus, setSystemStatus] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [prices, setPrices] = useState({});
  const [signals, setSignals] = useState([]);
  const [trades, setTrades] = useState([]);
  const [balances, setBalances] = useState({});
  const [account, setAccount] = useState(null);
  const [tradingEnabled, setTradingEnabled] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState('balanced');
  const [selectedTimeframe, setSelectedTimeframe] = useState('1h');
  const [priceChartData, setPriceChartData] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  // Initialize socket connection
  useEffect(() => {
    // Use different URLs for development vs production
    const socketUrl = import.meta.env.DEV ? 'http://localhost:3001' : '';
    const newSocket = io(socketUrl);
    setSocket(newSocket);

    // Socket event listeners
    newSocket.on('connect', () => {
      console.log('Connected to trading server');
      fetchInitialData();
    });

    newSocket.on('systemStatus', (status) => {
      setSystemStatus(status);
      setTradingEnabled(status.config?.enableTrading || false);
      setLoading(false);
    });

    newSocket.on('portfolioUpdated', (portfolioData) => {
      setPortfolio(portfolioData);
    });

    newSocket.on('priceUpdate', (priceData) => {
      setPrices(prev => ({
        ...prev,
        [priceData.symbol]: priceData
      }));
      
      // Update price chart data
      setPriceChartData(prev => {
        const newData = [...prev, {
          time: new Date(priceData.timestamp).toLocaleTimeString(),
          price: priceData.price,
          symbol: priceData.symbol
        }].slice(-50); // Keep last 50 data points
        return newData;
      });
    });

    newSocket.on('signalGenerated', (data) => {
      setSignals(prev => [data.signal, ...prev].slice(0, 100));
    });

    newSocket.on('tradeExecuted', (trade) => {
      setTrades(prev => [trade, ...prev].slice(0, 50));
    });

    newSocket.on('tradingHalted', (data) => {
      setError(`Trading Halted: ${data.reason}`);
      setTradingEnabled(false);
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from trading server');
    });

    return () => newSocket.close();
  }, []);

  const fetchInitialData = async () => {
    try {
      console.log('Fetching initial data...');
      
      // Fetch initial data with individual error handling
      const requests = [
        { name: 'status', url: '/api/trading/status' },
        { name: 'portfolio', url: '/api/trading/portfolio' },
        { name: 'trades', url: '/api/trading/trades?limit=20' },
        { name: 'signals', url: '/api/trading/signals?limit=20' },
        { name: 'prices', url: '/api/trading/prices' },
        { name: 'balances', url: '/api/trading/balances' },
        { name: 'account', url: '/api/trading/account' }
      ];

      const results = {};
      let hasErrors = false;

      for (const request of requests) {
        try {
          console.log(`Fetching ${request.name}...`);
          const response = await fetch(request.url);
          
          if (!response.ok) {
            console.error(`${request.name} API error:`, response.status, response.statusText);
            hasErrors = true;
            continue;
          }
          
          const data = await response.json();
          results[request.name] = data;
          console.log(`✅ ${request.name} loaded:`, data);
          
        } catch (error) {
          console.error(`Error fetching ${request.name}:`, error);
          hasErrors = true;
        }
      }

      // Update state with successful results
      if (results.status) setSystemStatus(results.status);
      if (results.portfolio) setPortfolio(results.portfolio);
      if (results.trades) setTrades(results.trades);
      if (results.signals) setSignals(results.signals);
      if (results.prices) setPrices(results.prices);
      if (results.balances) setBalances(results.balances);
      if (results.account) setAccount(results.account);

      // Clear error if we got some data
      if (!hasErrors) {
        setError(null);
      } else {
        setError('Some trading data failed to load, but system is operational');
      }

    } catch (error) {
      console.error('Error in fetchInitialData:', error);
      setError('Failed to load trading data: ' + error.message);
    }
  };

  const handleToggleTrading = async () => {
    try {
      const endpoint = tradingEnabled ? '/api/trading/stop' : '/api/trading/start';
      const response = await fetch(endpoint, { method: 'POST' });
      
      if (response.ok) {
        setTradingEnabled(!tradingEnabled);
        setError(null);
      } else {
        const errorData = await response.json();
        setError(errorData.error);
      }
    } catch (error) {
      setError('Failed to toggle trading');
    }
  };

  const handleResetTrading = async () => {
    try {
      const response = await fetch('/api/trading/reset', { method: 'POST' });
      if (response.ok) {
        setError(null);
        fetchInitialData();
      } else {
        const errorData = await response.json();
        setError(errorData.error);
      }
    } catch (error) {
      setError('Failed to reset trading');
    }
  };

  const handleStrategyChange = async (event) => {
    const newStrategy = event.target.value;
    setSelectedStrategy(newStrategy);
    
    try {
      const response = await fetch('/api/trading/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy: newStrategy })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        setError(errorData.error);
      }
    } catch (error) {
      setError('Failed to update strategy');
    }
  };

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

  const calculateBalanceValue = (balance, prices) => {
    if (!balance || !prices) return 0;
    
    // For USDT, value is 1:1
    if (balance.asset === 'USDT') return balance.total;
    
    // For other assets, multiply by current price
    const symbol = `${balance.asset}USDT`;
    const price = prices[symbol]?.price || 0;
    return balance.total * price;
  };

  const getTotalBalanceValue = () => {
    if (!account?.balances || !prices) return 0;
    
    return account.balances.reduce((total, balance) => {
      return total + calculateBalanceValue(balance, prices);
    }, 0);
  };

  const formatPercent = (value) => {
    return `${(value || 0).toFixed(2)}%`;
  };

  const getSignalColor = (signal) => {
    if (signal.includes('BUY')) return 'success';
    if (signal.includes('SELL')) return 'error';
    return 'default';
  };

  const getSignalIcon = (signal) => {
    if (signal.includes('BUY')) return <TrendingUp />;
    if (signal.includes('SELL')) return <TrendingDown />;
    return <Timeline />;
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
        <Typography variant="h6">Loading Trading Dashboard...</Typography>
      </Box>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      {/* Header */}
      <Box mb={3}>
        <Typography variant="h4" component="h1" gutterBottom>
          Crypto Trend Trading Bot
        </Typography>
        
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* Controls */}
        <Paper sx={{ p: 2, mb: 3 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item>
              <Button
                variant={tradingEnabled ? "contained" : "outlined"}
                color={tradingEnabled ? "error" : "success"}
                startIcon={tradingEnabled ? <Stop /> : <PlayArrow />}
                onClick={handleToggleTrading}
              >
                {tradingEnabled ? 'Stop Trading' : 'Start Trading'}
              </Button>
            </Grid>
            
            <Grid item>
              <Button
                variant="outlined"
                startIcon={<Refresh />}
                onClick={() => {
                  setError(null);
                  fetchInitialData();
                }}
              >
                Refresh Data
              </Button>
            </Grid>

            <Grid item>
              <FormControl size="small" sx={{ minWidth: 120 }}>
                <InputLabel>Strategy</InputLabel>
                <Select
                  value={selectedStrategy}
                  label="Strategy"
                  onChange={handleStrategyChange}
                >
                  <MenuItem value="conservative">Conservative</MenuItem>
                  <MenuItem value="balanced">Balanced</MenuItem>
                  <MenuItem value="responsive">Responsive</MenuItem>
                </Select>
              </FormControl>
            </Grid>

            <Grid item>
              <Chip
                icon={systemStatus?.isInitialized ? <PlayArrow /> : <Stop />}
                label={systemStatus?.isInitialized ? 'System Online' : 'System Offline'}
                color={systemStatus?.isInitialized ? 'success' : 'error'}
              />
            </Grid>
          </Grid>
        </Paper>
      </Box>

      <Grid container spacing={3}>
        {/* Portfolio Overview */}
        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Portfolio Overview
            </Typography>
            
            <Grid container spacing={3}>
              <Grid item xs={6} md={3}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography color="textSecondary" gutterBottom>
                      Total Value
                    </Typography>
                    <Typography variant="h5">
                      {formatCurrency(portfolio?.totalValue)}
                    </Typography>
                    <Typography variant="body2" color={portfolio?.totalPnL >= 0 ? 'success.main' : 'error.main'}>
                      {portfolio?.totalPnL >= 0 ? '+' : ''}{formatCurrency(portfolio?.totalPnL)}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>

              <Grid item xs={6} md={3}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography color="textSecondary" gutterBottom>
                      Total Return
                    </Typography>
                    <Typography variant="h5" color={portfolio?.totalPnLPercent >= 0 ? 'success.main' : 'error.main'}>
                      {formatPercent(portfolio?.totalPnLPercent)}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>

              <Grid item xs={6} md={3}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography color="textSecondary" gutterBottom>
                      Active Positions
                    </Typography>
                    <Typography variant="h5">
                      {portfolio?.positionCount || 0}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>

              <Grid item xs={6} md={3}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography color="textSecondary" gutterBottom>
                      Win Rate
                    </Typography>
                    <Typography variant="h5">
                      {formatPercent(portfolio?.performance?.winRate)}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>

            {/* Positions */}
            {portfolio?.positions && portfolio.positions.length > 0 && (
              <Box mt={3}>
                <Typography variant="h6" gutterBottom>
                  Open Positions
                </Typography>
                {portfolio.positions.map((position) => (
                  <Card key={position.symbol} variant="outlined" sx={{ mb: 1 }}>
                    <CardContent sx={{ py: 1 }}>
                      <Grid container alignItems="center" spacing={2}>
                        <Grid item xs={2}>
                          <Typography variant="subtitle1">
                            {position.symbol.replace('USDT', '')}
                          </Typography>
                        </Grid>
                        <Grid item xs={2}>
                          <Typography variant="body2">
                            {position.quantity.toFixed(6)}
                          </Typography>
                        </Grid>
                        <Grid item xs={2}>
                          <Typography variant="body2">
                            {formatCurrency(position.avgPrice)}
                          </Typography>
                        </Grid>
                        <Grid item xs={2}>
                          <Typography variant="body2">
                            {formatCurrency(position.currentPrice)}
                          </Typography>
                        </Grid>
                        <Grid item xs={2}>
                          <Typography 
                            variant="body2" 
                            color={position.unrealizedPnL >= 0 ? 'success.main' : 'error.main'}
                          >
                            {formatCurrency(position.unrealizedPnL)}
                          </Typography>
                        </Grid>
                        <Grid item xs={2}>
                          <Typography variant="body2" color="textSecondary">
                            SL: {formatCurrency(position.stopLoss)}
                          </Typography>
                        </Grid>
                      </Grid>
                    </CardContent>
                  </Card>
                ))}
              </Box>
            )}
          </Paper>
        </Grid>

        {/* Crypto Balances */}
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Crypto Balances
            </Typography>
            
            {account && account.balances && account.balances.length > 0 ? (
              <>
                {/* Total Balance Summary */}
                <Card variant="outlined" sx={{ mb: 2, bgcolor: 'primary.dark' }}>
                  <CardContent sx={{ py: 1 }}>
                    <Typography variant="h6" color="primary.contrastText">
                      Total Balance Value
                    </Typography>
                    <Typography variant="h5" color="primary.contrastText">
                      {formatCurrency(getTotalBalanceValue())}
                    </Typography>
                  </CardContent>
                </Card>

                {/* Individual Balances */}
                {account.balances
                  .filter(balance => balance.total > 0)
                  .map((balance) => {
                    const usdValue = calculateBalanceValue(balance, prices);
                    return (
                      <Card key={balance.asset} variant="outlined" sx={{ mb: 1 }}>
                        <CardContent sx={{ py: 1 }}>
                          <Grid container alignItems="center" spacing={1}>
                            <Grid item xs={12}>
                              <Typography variant="subtitle1" fontWeight="bold">
                                {balance.asset}
                              </Typography>
                            </Grid>
                            <Grid item xs={6}>
                              <Typography variant="body2">
                                {formatCrypto(balance.total)} {balance.asset}
                              </Typography>
                              <Typography variant="caption" color="textSecondary">
                                Total Balance
                              </Typography>
                            </Grid>
                            <Grid item xs={6}>
                              <Typography variant="body2" color="success.main">
                                {formatCurrency(usdValue)}
                              </Typography>
                              <Typography variant="caption" color="textSecondary">
                                USD Value
                              </Typography>
                            </Grid>
                            {balance.locked > 0 && (
                              <Grid item xs={12}>
                                <Typography variant="caption" color="warning.main">
                                  Locked: {formatCrypto(balance.locked)} {balance.asset}
                                </Typography>
                              </Grid>
                            )}
                          </Grid>
                        </CardContent>
                      </Card>
                    );
                  })
                }
              </>
            ) : (
              <Typography variant="body2" color="textSecondary">
                {account ? 'No balances found' : 'Loading balances...'}
              </Typography>
            )}

            {account && (
              <Box mt={2}>
                <Typography variant="caption" color="textSecondary">
                  Account Type: {account.accountType || 'SPOT'}
                </Typography>
                <br />
                <Typography variant="caption" color="textSecondary">
                  Trading: {account.canTrade ? '✅ Enabled' : '❌ Disabled'}
                </Typography>
              </Box>
            )}
          </Paper>
        </Grid>

        {/* Live Prices */}
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Live Prices
            </Typography>
            
            {Object.entries(prices).map(([symbol, data]) => (
              <Card key={symbol} variant="outlined" sx={{ mb: 1 }}>
                <CardContent sx={{ py: 1 }}>
                  <Grid container alignItems="center" justifyContent="space-between">
                    <Grid item>
                      <Typography variant="subtitle1">
                        {symbol.replace('USDT', '')}
                      </Typography>
                    </Grid>
                    <Grid item>
                      <Typography variant="h6">
                        {formatCurrency(data.price)}
                      </Typography>
                    </Grid>
                    <Grid item>
                      <Chip
                        size="small"
                        label={formatPercent(data.priceChange)}
                        color={data.priceChange >= 0 ? 'success' : 'error'}
                      />
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>
            ))}
          </Paper>
        </Grid>

        {/* Trading Signals */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3, height: 400, overflow: 'auto' }}>
            <Typography variant="h6" gutterBottom>
              Recent Signals
            </Typography>
            
            {signals.slice(0, 10).map((signal, index) => (
              <Card key={index} variant="outlined" sx={{ mb: 1 }}>
                <CardContent sx={{ py: 1 }}>
                  <Grid container alignItems="center" spacing={1}>
                    <Grid item>
                      {getSignalIcon(signal.signal)}
                    </Grid>
                    <Grid item xs={2}>
                      <Typography variant="body2">
                        {signal.symbol?.replace('USDT', '')}
                      </Typography>
                    </Grid>
                    <Grid item xs={3}>
                      <Chip
                        size="small"
                        label={signal.signal}
                        color={getSignalColor(signal.signal)}
                      />
                    </Grid>
                    <Grid item xs={2}>
                      <Typography variant="body2">
                        {signal.strength?.toFixed(1)}
                      </Typography>
                    </Grid>
                    <Grid item xs={4}>
                      <Typography variant="body2" color="textSecondary">
                        {new Date(signal.timestamp).toLocaleTimeString()}
                      </Typography>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>
            ))}
          </Paper>
        </Grid>

        {/* Recent Trades */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3, height: 400, overflow: 'auto' }}>
            <Typography variant="h6" gutterBottom>
              Recent Trades
            </Typography>
            
            {trades.slice(0, 10).map((trade, index) => (
              <Card key={index} variant="outlined" sx={{ mb: 1 }}>
                <CardContent sx={{ py: 1 }}>
                  <Grid container alignItems="center" spacing={1}>
                    <Grid item>
                      {trade.side === 'BUY' ? <TrendingUp color="success" /> : <TrendingDown color="error" />}
                    </Grid>
                    <Grid item xs={2}>
                      <Typography variant="body2">
                        {trade.symbol?.replace('USDT', '')}
                      </Typography>
                    </Grid>
                    <Grid item xs={2}>
                      <Chip
                        size="small"
                        label={trade.side}
                        color={trade.side === 'BUY' ? 'success' : 'error'}
                      />
                    </Grid>
                    <Grid item xs={2}>
                      <Typography variant="body2">
                        {formatCurrency(trade.price)}
                      </Typography>
                    </Grid>
                    <Grid item xs={2}>
                      {trade.pnl !== undefined && (
                        <Typography 
                          variant="body2" 
                          color={trade.pnl >= 0 ? 'success.main' : 'error.main'}
                        >
                          {formatCurrency(trade.pnl)}
                        </Typography>
                      )}
                    </Grid>
                    <Grid item xs={2}>
                      <Typography variant="body2" color="textSecondary">
                        {new Date(trade.timestamp).toLocaleTimeString()}
                      </Typography>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>
            ))}
          </Paper>
        </Grid>

        {/* Price Chart */}
        <Grid item xs={12}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Live Price Chart
            </Typography>
            
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={priceChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" />
                <YAxis />
                <Tooltip />
                <Line 
                  type="monotone" 
                  dataKey="price" 
                  stroke="#8884d8" 
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </Paper>
        </Grid>
      </Grid>
    </Container>
  );
};

export default TradingDashboard;