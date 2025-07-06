// frontend/src/components/RecentTrades.jsx
import React from 'react';
import PropTypes from 'prop-types';
import {
  Paper,
  Typography,
  Card,
  CardContent,
  Grid,
  Chip,
  Box
} from '@mui/material';
import {
  TrendingUp,
  TrendingDown,
  ErrorOutline
} from '@mui/icons-material';

const RecentTrades = ({ trades }) => {
  const formatUSDT = (value) => {
    // Ensure value is a number before formatting
    const numericValue = Number(value);
    if (isNaN(numericValue)) {
      return 'N/A USDT';
    }
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(numericValue) + ' USDT';
  };

  // Guard Clause: This is the most critical fix. If `trades` is not an array
  // for any reason, this component will render a safe fallback UI instead of crashing.
  if (!Array.isArray(trades)) {
    // Log the unexpected prop type in development for easier debugging
    if (import.meta.env.DEV) {
      console.error('RecentTrades received a non-array prop:', trades);
    }
    return (
      <Paper sx={{ p: 3, height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          Loading recent trades...
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper sx={{ p: 3, height: 400, overflow: 'auto' }}>
      <Typography variant="h6" gutterBottom>
        Recent Trades
      </Typography>
      
      {trades.length === 0 ? (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '80%' }}>
          <Typography variant="body2" color="text.secondary">
            No recent trades to display.
          </Typography>
        </Box>
      ) : (
        trades.slice(0, 15).map((trade, index) => {
          // Defensive data access for each trade object to prevent crashes from malformed data
          if (!trade || typeof trade !== 'object') {
            return (
              <Card key={`error-${index}`} variant="outlined" sx={{ mb: 1, borderColor: 'error.main' }}>
                <CardContent sx={{ py: 1 }}>
                  <Grid container alignItems="center" spacing={1}>
                    <Grid item><ErrorOutline color="error" /></Grid>
                    <Grid item><Typography variant="body2" color="error.main">Invalid trade data received</Typography></Grid>
                  </Grid>
                </CardContent>
              </Card>
            );
          }

          const side = trade.side || 'UNKNOWN';
          const symbol = String(trade.symbol || 'N/A');
          const price = Number(trade.price || 0);
          const usdtCost = trade.usdtCost;
          const usdtReceived = trade.usdtReceived;
          const pnl = trade.pnl; // Can be undefined, handled below
          const timestamp = trade.timestamp ? new Date(trade.timestamp).toLocaleString() : 'Invalid Date';
          // Use a more stable key if a unique ID is available from the backend
          const uniqueKey = trade.id || `${symbol}-${trade.timestamp}-${index}`;

          return (
            <Card key={uniqueKey} variant="outlined" sx={{ mb: 1 }}>
              <CardContent sx={{ py: 1 }}>
                <Grid container alignItems="center" spacing={1}>
                  <Grid item>
                    {side === 'BUY' ? <TrendingUp color="success" /> : <TrendingDown color="error" />}
                  </Grid>
                  <Grid item xs={2}>
                    <Typography variant="body2" fontWeight="bold">
                      {symbol.replace('USDT', '')}
                    </Typography>
                  </Grid>
                  <Grid item xs={2}>
                    <Chip
                      size="small"
                      label={side}
                      color={side === 'BUY' ? 'success' : 'error'}
                    />
                  </Grid>
                  <Grid item xs={2}>
                    <Typography variant="body2">
                      ${price.toFixed(price > 1 ? 2 : 6)}
                    </Typography>
                  </Grid>
                  <Grid item xs={2}>
                    <Typography variant="body2" color="info.main">
                      {side === 'BUY' 
                        ? formatUSDT(usdtCost)
                        : formatUSDT(usdtReceived)
                      }
                    </Typography>
                  </Grid>
                  <Grid item xs={2}>
                    {pnl !== undefined && (
                      <Typography 
                        variant="body2" 
                        color={Number(pnl) >= 0 ? 'success.main' : 'error.main'}
                        fontWeight="bold"
                      >
                        {Number(pnl) >= 0 ? '+' : ''}{formatUSDT(pnl)}
                      </Typography>
                    )}
                  </Grid>
                  <Grid item xs={12}>
                    <Typography variant="caption" color="textSecondary">
                      {timestamp}
                    </Typography>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>
          );
        })
      )}
    </Paper>
  );
};

RecentTrades.propTypes = {
  /** An array of trade objects to be displayed. */
  trades: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    symbol: PropTypes.string,
    side: PropTypes.oneOf(['BUY', 'SELL', 'UNKNOWN']),
    price: PropTypes.number,
    usdtCost: PropTypes.number,
    usdtReceived: PropTypes.number,
    pnl: PropTypes.number,
    timestamp: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  })),
};

export default RecentTrades;