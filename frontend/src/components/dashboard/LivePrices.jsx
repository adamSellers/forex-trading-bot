// frontend/src/components/dashboard/LivePrices.jsx - Forex Version
import React, { useState, useMemo } from 'react';
import { 
  Box, Typography, Chip, Skeleton, useTheme, alpha, 
  Stack, styled, Tooltip
} from '@mui/material';
import { 
  CurrencyExchange, TrendingUp, TrendingDown, SwapHoriz
} from '@mui/icons-material';
import { formatPrice, formatInstrument, INSTRUMENT_INFO } from './Shared';

// --- STYLED COMPONENTS ---
const TickerRow = styled(Box)(({ theme }) => ({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: theme.spacing(1.5, 2),
  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  transition: 'background-color 0.2s',
  '&:hover': {
    backgroundColor: alpha(theme.palette.action.hover, 0.1),
  },
  '&:last-child': {
    borderBottom: 'none'
  }
}));

const PriceText = styled(Typography)(({ color }) => ({
  fontFamily: '"Roboto Mono", monospace',
  fontWeight: 700,
  color: color,
  transition: 'color 0.3s ease'
}));

/**
 * LivePrices - Forex price display component
 * @param {Object} prices - Price data keyed by instrument (e.g., { AUD_USD: { bid, ask, mid, spread } })
 * @param {Array} assets - List of instruments to display (e.g., ['AUD_USD', 'EUR_USD'])
 */
const LivePrices = ({ prices = {}, assets = [] }) => {
  const theme = useTheme();
  const [prevPrices, setPrevPrices] = useState({});

  // Track price changes for color coding
  const priceChanges = useMemo(() => {
    const changes = {};
    assets.forEach(instrument => {
      const current = prices[instrument]?.mid || prices[instrument]?.price;
      const prev = prevPrices[instrument];
      if (current && prev) {
        if (current > prev) changes[instrument] = 'up';
        else if (current < prev) changes[instrument] = 'down';
      }
    });
    // Update prev prices for next comparison
    const newPrev = {};
    assets.forEach(instrument => {
      newPrev[instrument] = prices[instrument]?.mid || prices[instrument]?.price;
    });
    if (Object.keys(newPrev).length > 0) {
      setTimeout(() => setPrevPrices(newPrev), 0);
    }
    return changes;
  }, [prices, assets]);

  // Render a single instrument row
  const RenderRow = ({ instrument }) => {
    const priceData = prices[instrument];
    const info = INSTRUMENT_INFO[instrument] || {};
    
    if (!priceData) {
      return (
        <TickerRow>
          <Typography variant="body2" fontWeight="700">{formatInstrument(instrument)}</Typography>
          <Typography variant="body2" color="text.secondary">---</Typography>
        </TickerRow>
      );
    }

    const mid = priceData.mid || priceData.price;
    const bid = priceData.bid;
    const ask = priceData.ask;
    const spread = priceData.spread;
    
    // Color based on price movement
    let color = theme.palette.text.primary;
    let Icon = null;
    if (priceChanges[instrument] === 'up') {
      color = theme.palette.success.main;
      Icon = TrendingUp;
    } else if (priceChanges[instrument] === 'down') {
      color = theme.palette.error.main;
      Icon = TrendingDown;
    }

    return (
      <TickerRow>
        <Box display="flex" flexDirection="column" width="100%">
          <Box display="flex" justifyContent="space-between" alignItems="center" width="100%">
            {/* Instrument Name */}
            <Box display="flex" alignItems="center" gap={1}>
              <Typography variant="body2" sx={{ fontSize: '1rem' }}>
                {info.flag || '💱'}
              </Typography>
              <Box>
                <Typography variant="body2" fontWeight="700">
                  {formatInstrument(instrument)}
                </Typography>
              </Box>
            </Box>
            
            {/* Price */}
            <Box textAlign="right" display="flex" alignItems="center" gap={0.5}>
              {Icon && <Icon sx={{ fontSize: 14, color }} />}
              <PriceText variant="body2" color={color}>
                {formatPrice(mid, instrument)}
              </PriceText>
            </Box>
          </Box>
          
          {/* Bid/Ask Spread Row */}
          <Box display="flex" justifyContent="space-between" alignItems="center" mt={0.5}>
            <Box display="flex" alignItems="center" gap={1}>
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>
                B: {formatPrice(bid, instrument)}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>
                A: {formatPrice(ask, instrument)}
              </Typography>
            </Box>
            
            {/* Spread */}
            <Tooltip title="Spread in pips">
              <Chip
                icon={<SwapHoriz sx={{ fontSize: 12 }} />}
                label={`${spread?.toFixed(1) || '---'} pips`}
                size="small"
                variant="outlined"
                sx={{ 
                  height: 18, 
                  fontSize: '0.65rem',
                  '& .MuiChip-icon': { fontSize: 12, ml: 0.5 },
                  '& .MuiChip-label': { px: 0.5 }
                }}
              />
            </Tooltip>
          </Box>
        </Box>
      </TickerRow>
    );
  };

  // Loading state
  if (assets.length === 0 || Object.keys(prices).length === 0) {
    return (
      <Box p={2}>
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} variant="text" height={50} sx={{ my: 1 }} />
        ))}
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box 
        px={2} py={1} 
        bgcolor={alpha(theme.palette.primary.main, 0.05)} 
        borderBottom={`1px solid ${alpha(theme.palette.divider, 0.1)}`}
        display="flex" alignItems="center" gap={1}
      >
        <CurrencyExchange sx={{ fontSize: 14, color: 'text.secondary' }} />
        <Typography variant="caption" fontWeight="bold" color="text.secondary">
          FOREX PAIRS
        </Typography>
        <Chip 
          label={assets.length} 
          size="small" 
          sx={{ height: 16, fontSize: '0.6rem', ml: 'auto' }} 
        />
      </Box>
      
      {/* Price Rows */}
      <Stack>
        {assets.map(instrument => (
          <RenderRow key={instrument} instrument={instrument} />
        ))}
      </Stack>
    </Box>
  );
};

export default LivePrices;