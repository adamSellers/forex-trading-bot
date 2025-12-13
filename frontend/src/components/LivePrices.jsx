// frontend/src/components/LivePrices.jsx
import React, { useEffect, useState, useRef, useMemo } from 'react';
import { 
  Box, Typography, Chip, Skeleton, useTheme, alpha, 
  Divider, LinearProgress, Stack, styled, Fade
} from '@mui/material';
import { 
  PieChart, Visibility, TrendingUp, TrendingDown 
} from '@mui/icons-material';
import { tradingAPI, socket } from '../config/api';

// --- STYLED COMPONENTS ---
const TickerRow = styled(Box)(({ theme, active }) => ({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: theme.spacing(1.5, 2),
  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  backgroundColor: active ? alpha(theme.palette.primary.main, 0.03) : 'transparent',
  transition: 'background-color 0.2s',
  '&:hover': {
    backgroundColor: alpha(theme.palette.action.hover, 0.1),
  },
  '&:last-child': {
    borderBottom: 'none'
  }
}));

// Fixed: Removed unused 'theme' prop
const PriceText = styled(Typography)(({ color }) => ({
  fontFamily: '"Roboto Mono", monospace',
  fontWeight: 700,
  color: color,
  transition: 'color 0.3s ease'
}));

const AllocationBar = styled(LinearProgress)(({ theme }) => ({
  height: 2,
  borderRadius: 2,
  marginTop: 4,
  backgroundColor: alpha(theme.palette.primary.main, 0.1),
  '& .MuiLinearProgress-bar': {
    borderRadius: 2,
  }
}));

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

    const parsePrice = (input) => {
        if (typeof input === 'object' && input !== null) return parseFloat(input.price);
        return parseFloat(input);
    };

    // A. Initial Fetch
    const fetchInitial = async () => {
        try {
            const data = await tradingAPI.getPrices();
            const initialMap = {};
            if (data) {
                Object.keys(data).forEach(key => {
                    if (key !== 'symbol' && key !== 'price') {
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
      setPrevPrices(pricesRef.current);

      setPrices(currentPrices => {
          const newPrices = { ...currentPrices };
          
          if (data && data.symbol && data.price) {
              newPrices[data.symbol] = parsePrice(data.price);
          } 
          else if (typeof data === 'object') {
              Object.keys(data).forEach(key => {
                  if (data[key]) newPrices[key] = parsePrice(data[key]);
              });
          }

          pricesRef.current = newPrices;
          return newPrices;
      });
    };

    socket.on('priceUpdate', handlePriceUpdate);
    return () => { socket.off('priceUpdate', handlePriceUpdate); };
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
  const RenderRow = ({ symbol, isActive }) => {
      const price = prices[symbol];
      const prev = prevPrices[symbol];
      const targetWeight = allocation[symbol] || 0;
      
      // Color Logic
      let color = theme.palette.text.primary;
      
      if (price && prev) {
        if (price > prev) {
            color = theme.palette.success.main;
        } else if (price < prev) {
            color = theme.palette.error.main;
        }
      }

      const formattedPrice = isNaN(price) 
        ? '---' 
        : price < 10 
            ? price.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })
            : price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      return (
        <TickerRow active={isActive ? 1 : 0}>
            <Box display="flex" flexDirection="column" width="100%">
                <Box display="flex" justifyContent="space-between" alignItems="center" width="100%">
                    <Box display="flex" alignItems="center" gap={1}>
                        <Typography variant="body2" fontWeight="700">
                            {symbol.replace('USDT', '')}
                        </Typography>
                        {isActive && (
                            <Chip 
                                label={`${targetWeight}%`} 
                                size="small" 
                                color="primary" 
                                variant="filled"
                                sx={{ 
                                    height: 16, 
                                    fontSize: '0.6rem', 
                                    fontWeight: 'bold',
                                    borderRadius: 0.5
                                }} 
                            />
                        )}
                    </Box>
                    
                    <Box textAlign="right">
                        <PriceText variant="body2" color={color}>
                            ${formattedPrice}
                        </PriceText>
                    </Box>
                </Box>
                
                {/* Allocation Progress Bar for Active Assets */}
                {isActive && (
                    <Box mt={0.5} width="100%">
                        <AllocationBar 
                            variant="determinate" 
                            value={Math.min(targetWeight * 2, 100)} // Scale purely for visual
                            color="primary"
                        />
                    </Box>
                )}
            </Box>
        </TickerRow>
      );
  };

  if (loading && Object.keys(prices).length === 0) {
    return (
      <Box p={2}>
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} variant="text" height={40} sx={{ my: 1 }} />
        ))}
      </Box>
    );
  }

  return (
    <Box>
        {/* SECTION 1: ACTIVE PORTFOLIO */}
        {portfolioAssets.length > 0 && (
            <Box>
                <Box 
                    px={2} py={1} 
                    bgcolor={alpha(theme.palette.primary.main, 0.05)} 
                    borderBottom={`1px solid ${alpha(theme.palette.divider, 0.1)}`}
                    display="flex" alignItems="center" gap={1}
                >
                    <PieChart sx={{ fontSize: 14, color: 'text.secondary' }} />
                    <Typography variant="caption" fontWeight="bold" color="text.secondary">
                        ALLOCATION
                    </Typography>
                </Box>
                <Stack>
                    {portfolioAssets.map(symbol => (
                        <RenderRow key={symbol} symbol={symbol} isActive={true} />
                    ))}
                </Stack>
            </Box>
        )}

        {/* SECTION 2: WATCHLIST */}
        {watchlistAssets.length > 0 && (
            <Box>
                 <Box 
                    px={2} py={1} 
                    bgcolor={alpha(theme.palette.background.default, 0.4)} 
                    borderBottom={`1px solid ${alpha(theme.palette.divider, 0.1)}`}
                    borderTop={portfolioAssets.length > 0 ? `1px solid ${alpha(theme.palette.divider, 0.1)}` : 'none'}
                    display="flex" alignItems="center" gap={1}
                >
                    <Visibility sx={{ fontSize: 14, color: 'text.secondary' }} />
                    <Typography variant="caption" fontWeight="bold" color="text.secondary">
                        MARKET WATCH
                    </Typography>
                </Box>
                <Stack>
                    {watchlistAssets.map(symbol => (
                        <RenderRow key={symbol} symbol={symbol} isActive={false} />
                    ))}
                </Stack>
            </Box>
        )}
        
        {portfolioAssets.length === 0 && watchlistAssets.length === 0 && (
             <Box p={3} textAlign="center">
                <Typography variant="caption" color="text.secondary">
                    Waiting for market data...
                </Typography>
            </Box>
        )}
    </Box>
  );
};

export default LivePrices;