// frontend/src/components/LivePrices.jsx - ROBUST SOCKET HANDLER
import React, { useEffect, useState, useRef } from 'react';
import { 
  Box, Grid, Card, CardContent, Typography, Chip, Skeleton, useTheme, alpha 
} from '@mui/material';
import { 
  TrendingUp, TrendingDown, PieChart, DonutLarge, Bolt 
} from '@mui/icons-material';
import { tradingAPI, socket } from '../config/api';

const LivePrices = () => {
  const [prices, setPrices] = useState({});
  const [prevPrices, setPrevPrices] = useState({});
  const [allocation, setAllocation] = useState({});
  const [loading, setLoading] = useState(true);
  const theme = useTheme();
  
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

  // 2. WebSocket Logic
  useEffect(() => {
    setLoading(true);

    // A. Initial Fetch (Get full map immediately)
    const fetchInitial = async () => {
        try {
            const data = await tradingAPI.getPrices();
            // Ensure data is a map, not an array or single obj
            if (data && typeof data === 'object' && !data.symbol) {
                setPrices(data);
                pricesRef.current = data;
                setLoading(false);
            }
        } catch (e) { console.error(e); }
    };
    fetchInitial();

    // B. Listen for Updates
    const handlePriceUpdate = (data) => {
      setLoading(false);

      // SCENARIO 1: Single Ticker Update { symbol: 'BTC', price: 100 }
      // The backend is likely sending this to save bandwidth
      if (data.symbol && data.price) {
          setPrices(prev => {
              const newMap = { ...prev, [data.symbol]: parseFloat(data.price) };
              // Update ref/prev for color logic
              setPrevPrices(prev); 
              pricesRef.current = newMap;
              return newMap;
          });
      } 
      // SCENARIO 2: Full Map Update { BTC: 100, ETH: 200 }
      else {
          setPrevPrices(pricesRef.current);
          setPrices(data);
          pricesRef.current = data;
      }
    };

    socket.on('priceUpdate', handlePriceUpdate);

    // Cleanup
    return () => {
      socket.off('priceUpdate', handlePriceUpdate);
    };
  }, []);

  // Sort: Allocated Assets First, then Alphabetical
  const sortedSymbols = Object.keys(prices).sort((a, b) => {
    const allocA = allocation[a] || 0;
    const allocB = allocation[b] || 0;
    if (allocB !== allocA) return allocB - allocA; 
    return a.localeCompare(b);
  });

  if (loading && Object.keys(prices).length === 0) {
    return (
      <Grid container spacing={2}>
        {[1, 2, 3, 4].map((i) => (
          <Grid item xs={12} sm={6} md={3} key={i}>
            <Skeleton variant="rectangular" height={140} sx={{ borderRadius: 2 }} />
          </Grid>
        ))}
      </Grid>
    );
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
         <Box display="flex" alignItems="center" gap={1}>
            <Bolt color="primary" />
            <Typography variant="h6" fontWeight="bold">Live Market</Typography>
         </Box>
         
         <Chip 
            icon={<PieChart />} 
            label="Portfolio Weight" 
            size="small" 
            variant="outlined" 
            color="primary"
         />
      </Box>

      <Grid container spacing={2}>
        {sortedSymbols.map((symbol) => {
          // Safety Check: Don't render if it's not a valid ticker key
          if (symbol === 'symbol' || symbol === 'price') return null;

          const price = parseFloat(prices[symbol]);
          const prev = parseFloat(prevPrices[symbol]);
          const targetWeight = allocation[symbol] || 0;
          
          // Color Logic
          let color = theme.palette.text.primary;
          if (!isNaN(prev) && !isNaN(price)) {
            if (price > prev) color = theme.palette.success.main;
            if (price < prev) color = theme.palette.error.main;
          }

          const isActive = targetWeight > 0;
          const isHighConviction = targetWeight >= 20;

          return (
            <Grid item xs={12} sm={6} md={3} key={symbol}>
              <Card 
                variant="outlined" 
                sx={{ 
                    position: 'relative',
                    borderColor: isHighConviction ? 'primary.main' : 'divider',
                    borderWidth: isHighConviction ? 2 : 1,
                    backgroundColor: isHighConviction ? alpha(theme.palette.primary.main, 0.05) : 'background.paper',
                    transition: 'all 0.2s ease'
                }}
              >
                <CardContent>
                  {/* Header */}
                  <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={1}>
                    <Typography variant="h6" fontWeight="bold" color="text.secondary">
                        {symbol.replace('USDT', '')}
                    </Typography>
                    
                    <Chip 
                        label={isActive ? `${targetWeight}%` : "Watch"} 
                        size="small" 
                        color={isHighConviction ? "primary" : isActive ? "default" : "default"} 
                        variant={isActive ? "filled" : "outlined"}
                        icon={isActive ? <DonutLarge sx={{ fontSize: '14px !important' }} /> : null}
                        sx={{ fontWeight: 'bold', height: 24 }}
                    />
                  </Box>

                  {/* Price */}
                  <Typography variant="h4" fontWeight="bold" sx={{ color: color }}>
                    ${isNaN(price) ? '---' : price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                  </Typography>

                  {/* Weight Bar */}
                  {isActive ? (
                      <Box mt={2} display="flex" alignItems="center" gap={1}>
                          <Box 
                            height={4} 
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
                          <Typography variant="caption" color="text.secondary">
                              Target
                          </Typography>
                      </Box>
                  ) : (
                      <Box mt={2}>
                          <Typography variant="caption" color="text.disabled" fontStyle="italic">
                              No Capital Allocated
                          </Typography>
                      </Box>
                  )}

                </CardContent>
              </Card>
            </Grid>
          );
        })}
      </Grid>
    </Box>
  );
};

export default LivePrices;