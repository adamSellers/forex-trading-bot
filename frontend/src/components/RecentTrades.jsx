// frontend/src/components/RecentTrades.jsx - EXECUTION FEED STYLE
import React from 'react';
import PropTypes from 'prop-types';
import { Typography, Chip, Box, Stack, useTheme, alpha } from '@mui/material';
import { TrendingUp, TrendingDown, ReceiptLong } from '@mui/icons-material';

const RecentTrades = ({ trades }) => {
  const theme = useTheme();

  const formatUSDT = (value) => {
    const numericValue = Number(value);
    if (isNaN(numericValue)) return '---';
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numericValue);
  };

  if (!Array.isArray(trades)) {
    return (
        <Box p={3} textAlign="center" color="text.secondary">
            <Typography variant="caption">Loading Feed...</Typography>
        </Box>
    );
  }

  if (trades.length === 0) {
      return (
        <Box height="100%" display="flex" flexDirection="column" alignItems="center" justifyContent="center" color="text.secondary" p={3}>
            <ReceiptLong sx={{ fontSize: 40, opacity: 0.2, mb: 1 }} />
            <Typography variant="caption">NO EXECUTIONS LOGGED</Typography>
        </Box>
      );
  }

  return (
    <Stack spacing={0}>
        {trades.slice(0, 20).map((trade, index) => {
            if (!trade || typeof trade !== 'object') return null;

            const side = trade.side || 'UNKNOWN';
            const symbol = String(trade.symbol || 'N/A').replace('USDT', '');
            const price = Number(trade.price || 0);
            const pnl = Number(trade.pnl || 0);
            const isBuy = side === 'BUY';
            const color = isBuy ? theme.palette.success.main : theme.palette.error.main;
            const uniqueKey = trade.id || `${symbol}-${trade.timestamp}-${index}`;

            return (
              <Box 
                key={uniqueKey} 
                sx={{ 
                    p: 1.5, 
                    borderBottom: 1, 
                    borderColor: 'divider',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    transition: 'background-color 0.2s',
                    '&:hover': { bgcolor: alpha(color, 0.05) }
                }}
              >
                {/* Left: Icon & Symbol */}
                <Box display="flex" alignItems="center" gap={1.5}>
                    <Box sx={{ color: color, display: 'flex' }}>
                        {isBuy ? <TrendingUp fontSize="small" /> : <TrendingDown fontSize="small" />}
                    </Box>
                    <Box>
                        <Box display="flex" alignItems="center" gap={1}>
                            <Typography variant="body2" fontWeight="bold">{symbol}</Typography>
                            <Chip 
                                label={side} 
                                size="small" 
                                sx={{ 
                                    height: 16, 
                                    fontSize: '0.6rem', 
                                    fontWeight: 'bold',
                                    bgcolor: alpha(color, 0.1),
                                    color: color
                                }} 
                            />
                        </Box>
                        <Typography variant="caption" color="text.secondary" fontFamily="monospace">
                             @ {price.toFixed(price > 1 ? 2 : 5)}
                        </Typography>
                    </Box>
                </Box>

                {/* Right: Value & PnL */}
                <Box textAlign="right">
                    <Typography variant="body2" fontWeight="500">
                        ${isBuy ? formatUSDT(trade.usdtCost) : formatUSDT(trade.usdtReceived)}
                    </Typography>
                    
                    {!isBuy && (
                        <Typography 
                            variant="caption" 
                            fontWeight="bold"
                            sx={{ color: pnl >= 0 ? 'success.main' : 'error.main' }}
                        >
                            {pnl >= 0 ? '+' : ''}{formatUSDT(pnl)} PnL
                        </Typography>
                    )}
                    {isBuy && (
                        <Typography variant="caption" color="text.secondary">
                            ENTRY
                        </Typography>
                    )}
                </Box>
              </Box>
            );
        })}
    </Stack>
  );
};

RecentTrades.propTypes = {
  trades: PropTypes.array
};

export default RecentTrades;