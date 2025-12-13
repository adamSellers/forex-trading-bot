// frontend/src/components/LivePrices.jsx - WITH PORTFOLIO WEIGHT INDICATORS
import React, { useEffect, useState, useRef } from 'react';
import { 
  Box, Grid, Card, CardContent, Typography, Chip, Skeleton, useTheme, alpha 
} from '@mui/material';
import { 
  TrendingUp, TrendingDown, PieChart, DonutLarge 
} from '@mui/icons-material';
import { tradingAPI, socket } from '../config/api';

const LivePrices = () => {
  const [prices, setPrices] = useState({});
  const [prevPrices, setPrevPrices] = useState({});
  const [allocation, setAllocation] = useState({}); // Stores target % from config
  const [loading, setLoading] = useState(true);
  const theme = useTheme();
  
  // Use ref to keep track of previous prices for coloring
  const pricesRef = useRef({});

  // 1. Fetch Configuration (To get Allocations)
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const status = await tradingAPI.getStatus();
        if (status && status.config && status.config.allocation) {
          // Normalize allocation keys if needed (ensure 'BTCUSDT' matches)
          setAllocation(status.config.allocation);
        }
      } catch (err) {
        console.error("Failed to load allocation config:", err);
      }
    };
    fetchConfig();
  }, []);

  // 2. Setup WebSocket for Live Prices
  useEffect(() => {
    setLoading(true);

    // Initial fetch to populate quickly
    const fetchInitial = async () => {
        try {
            const data = await tradingAPI.getPrices();
            setPrices(data);
            pricesRef.current = data;
            setLoading(false);
        } catch (e) { console.error(e); }
    };
    fetchInitial();

    // Listen for updates
    socket.on('priceUpdate', (data) => {
      setPrevPrices(pricesRef.current);
      setPrices(data);
      pricesRef.current = data;
      setLoading(false);
    });

    return () => {
      socket.off('priceUpdate');
    };
  }, []);

  // Sort assets: High allocation first, then alphabetical
  const sortedSymbols = Object.keys(prices).sort((a, b) => {
    const allocA = allocation[a] || 0;
    const allocB = allocation[b] || 0;
    if (allocB !== allocA) return allocB - allocA; // Descending weight
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
         <Typography variant="h6" fontWeight="bold">Live Market & Allocations</Typography>
         <Chip 
            icon={<PieChart />} 
            label="Sorted by Portfolio Weight" 
            size="small" 
            variant="outlined" 
            color="primary"
         />
      </Box>

      <Grid container spacing={2}>
        {sortedSymbols.map((symbol) => {
          const price = parseFloat(prices[symbol]);
          const prev = parseFloat(prevPrices[symbol]);
          const targetWeight = allocation[symbol] || 0;
          
          // Determine Price Movement Color
          let color = theme.palette.text.primary;
          if (prev) {
            if (price > prev) color = theme.palette.success.main;
            if (price < prev) color = theme.palette.error.main;
          }

          // Determine Card Border (Highlight high conviction assets)
          const isHighConviction = targetWeight >= 20;
          const isActive = targetWeight > 0;

          return (
            <Grid item xs={12} sm={6} md={3} key={symbol}>
              <Card 
                variant="outlined" 
                sx={{ 
                    position: 'relative',
                    borderColor: isHighConviction ? 'primary.main' : 'divider',
                    borderWidth: isHighConviction ? 2 : 1,
                    backgroundColor: isHighConviction ? alpha(theme.palette.primary.main, 0.05) : 'background.paper',
                    transition: 'all 0.3s ease'
                }}
              >
                <CardContent>
                  {/* Header: Symbol + Weight Badge */}
                  <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={1}>
                    <Typography variant="h6" fontWeight="bold" color="text.secondary">
                        {symbol.replace('USDT', '')}
                    </Typography>
                    
                    {/* THE NEW INDICATOR */}
                    <Chip 
                        label={isActive ? `${targetWeight}%` : "Watch"} 
                        size="small" 
                        color={isHighConviction ? "primary" : isActive ? "default" : "default"} 
                        variant={isActive ? "filled" : "outlined"}
                        icon={isActive ? <DonutLarge sx={{ fontSize: '14px !important' }} /> : null}
                        sx={{ fontWeight: 'bold', height: 24 }}
                    />
                  </Box>

                  {/* Price Display */}
                  <Typography variant="h4" fontWeight="bold" sx={{ color: color }}>
                    ${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                  </Typography>

                  {/* Visual Decoration for "Weight" */}
                  {isActive && (
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
                  )}

                  {!isActive && (
                      <Box mt={2}>
                          <Typography variant="caption" color="text.disabled" fontStyle="italic">
                              Watching (No Capital Allocated)
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