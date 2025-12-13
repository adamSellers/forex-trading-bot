// frontend/src/components/LivePrices.jsx
import React, { useEffect, useState, useRef, useMemo } from 'react';
import { 
  Box, Grid, Card, CardContent, Typography, Chip, Skeleton, useTheme, alpha, Divider 
} from '@mui/material';
import { 
  Bolt, PieChart, ShowChart, Visibility 
} from '@mui/icons-material';
import { tradingAPI, socket } from '../config/api';

const LivePrices = () => {
  const [prices, setPrices] = useState({}); // Store as { SYMBOL: { price: Number, ... } }
  const [prevPrices, setPrevPrices] = useState({});
  const [allocation, setAllocation] = useState({});
  const [loading, setLoading] = useState(true);
  
  const theme = useTheme();
  
  // Use a ref to keep track of latest prices without triggering re-renders inside socket callbacks
  const pricesRef = useRef({});

  // 1. Fetch Config for Allocations
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const status = await tradingAPI.getStatus();
        if (status && status.config && status.config.allocation) {
          setAllocation(status.config.allocation);
        }
      } catch (err) {
        console.error("Failed to load allocation config:", err);
      }
    };
    fetchConfig();
  }, []);

  // 2. WebSocket & Data Logic
  useEffect(() => {
    setLoading(true);

    // Helper to safely parse price data
    const parsePrice = (input) => {
        if (typeof input === 'object' && input !== null) return parseFloat(input.price);
        return parseFloat(input);
    };

    // A. Initial Fetch (Snapshot)
    const fetchInitial = async () => {
        try {
            const data = await tradingAPI.getPrices();
            // Normalize API response to simple map { SYMBOL: price }
            const initialMap = {};
            if (data) {
                Object.keys(data).forEach(key => {
                    if (key !== 'symbol' && key !== 'price') { // Filter out stray keys
                        initialMap[key] = parsePrice(data[key]);
                    }
                });
                setPrices(initialMap);
                pricesRef.current = initialMap;
                setLoading(false);
            }
        } catch (e) { console.error(e); }
    };
    fetchInitial();

    // B. Socket Listener
    const handlePriceUpdate = (data) => {
      setLoading(false);
      
      // Update Reference for comparison (Previous Price)
      setPrevPrices(pricesRef.current);

      setPrices(currentPrices => {
          const newPrices = { ...currentPrices };
          
          // SCENARIO 1: Single Ticker Update { symbol: 'BTC', price: 100 }
          if (data && data.symbol && data.price) {
              newPrices[data.symbol] = parsePrice(data.price);
          } 
          // SCENARIO 2: Full Map Update { BTC: { price: 100 }, ETH: ... }
          else if (typeof data === 'object') {
              Object.keys(data).forEach(key => {
                  if (data[key]) newPrices[key] = parsePrice(data[key]);
              });
          }

          pricesRef.current = newPrices; // Sync Ref
          return newPrices;
      });
    };

    socket.on('priceUpdate', handlePriceUpdate);

    // Cleanup
    return () => {
      socket.off('priceUpdate', handlePriceUpdate);
    };
  }, []);

  // 3. Separation Logic
  const { portfolioAssets, watchlistAssets } = useMemo(() => {
      const allSymbols = Object.keys(prices).filter(k => k !== 'symbol' && k !== 'price');
      
      // Sort: Allocation High -> Low, then Alphabetical
      allSymbols.sort((a, b) => {
          const allocA = allocation[a] || 0;
          const allocB = allocation[b] || 0;
          if (allocB !== allocA) return allocB - allocA;
          return a.localeCompare(b);
      });

      const port = [];
      const watch = [];

      allSymbols.forEach(sym => {
          if ((allocation[sym] || 0) > 0) port.push(sym);
          else watch.push(sym);
      });

      return { portfolioAssets: port, watchlistAssets: watch };
  }, [prices, allocation]);


  // 4. Render Helpers
  const renderPriceCard = (symbol, isCompact = false) => {
      const price = prices[symbol];
      const prev = prevPrices[symbol];
      const targetWeight = allocation[symbol] || 0;
      
      // Color Logic
      let color = theme.palette.text.primary;
      if (price && prev) {
        if (price > prev) color = theme.palette.success.main;
        if (price < prev) color = theme.palette.error.main;
      }

      const formattedPrice = isNaN(price) 
        ? '---' 
        : price < 10 
            ? price.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })
            : price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      if (isCompact) {
          return (
            <Card variant="outlined" sx={{ bgcolor: 'background.paper' }}>
                <CardContent sx={{ p: '12px !important', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Box display="flex" alignItems="center" gap={1}>
                        <Typography variant="body2" fontWeight="bold" color="text.secondary">
                            {symbol.replace('USDT', '')}
                        </Typography>
                    </Box>
                    <Typography variant="body2" fontWeight="bold" sx={{ color }}>
                        ${formattedPrice}
                    </Typography>
                </CardContent>
            </Card>
          );
      }

      // Full Card (Portfolio)
      return (
        <Card 
            variant="outlined" 
            sx={{ 
                position: 'relative',
                borderColor: 'primary.main',
                borderWidth: 1,
                bgcolor: alpha(theme.palette.primary.main, 0.04)
            }}
        >
            <CardContent>
                <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={1}>
                    <Typography variant="h6" fontWeight="bold">
                        {symbol.replace('USDT', '')}
                    </Typography>
                    <Chip 
                        label={`${targetWeight}%`} 
                        size="small" 
                        color="primary" 
                        icon={<PieChart sx={{ fontSize: '14px !important' }} />}
                        sx={{ fontWeight: 'bold', height: 24 }}
                    />
                </Box>

                <Typography variant="h4" fontWeight="bold" sx={{ color }}>
                    ${formattedPrice}
                </Typography>

                <Box mt={2} display="flex" alignItems="center" gap={1}>
                    <Box 
                        height={6} 
                        flexGrow={1} 
                        bgcolor={alpha(theme.palette.primary.main, 0.2)} 
                        borderRadius={1}
                        overflow="hidden"
                    >
                        <Box 
                            height="100%" 
                            width={`${Math.min(targetWeight, 100)}%`} 
                            bgcolor="primary.main" 
                        />
                    </Box>
                </Box>
            </CardContent>
        </Card>
      );
  };

  if (loading && Object.keys(prices).length === 0) {
    return (
      <Grid container spacing={2}>
        {[1, 2, 3].map((i) => (
          <Grid item xs={12} key={i}>
            <Skeleton variant="rectangular" height={100} sx={{ borderRadius: 2 }} />
          </Grid>
        ))}
      </Grid>
    );
  }

  return (
    <Box>
        {/* Header */}
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
            <Box display="flex" alignItems="center" gap={1}>
                <Bolt color="primary" />
                <Typography variant="h6" fontWeight="bold">Live Market</Typography>
            </Box>
        </Box>

        {/* SECTION 1: ACTIVE PORTFOLIO */}
        <Box mb={3}>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                <PieChart fontSize="small" /> ACTIVE ALLOCATION
            </Typography>
            <Grid container spacing={2}>
                {portfolioAssets.map(symbol => (
                    <Grid item xs={12} sm={6} md={12} lg={6} key={symbol}>
                        {renderPriceCard(symbol, false)}
                    </Grid>
                ))}
            </Grid>
            {portfolioAssets.length === 0 && (
                <Typography variant="body2" color="text.secondary" fontStyle="italic">
                    No active assets allocated in config.
                </Typography>
            )}
        </Box>

        {/* SECTION 2: MARKET WATCH */}
        {watchlistAssets.length > 0 && (
            <Box>
                <Divider sx={{ mb: 2 }} />
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Visibility fontSize="small" /> WATCHLIST
                </Typography>
                <Grid container spacing={1}>
                    {watchlistAssets.map(symbol => (
                        <Grid item xs={6} sm={4} md={6} lg={4} key={symbol}>
                            {renderPriceCard(symbol, true)}
                        </Grid>
                    ))}
                </Grid>
            </Box>
        )}
    </Box>
  );
};

export default LivePrices;