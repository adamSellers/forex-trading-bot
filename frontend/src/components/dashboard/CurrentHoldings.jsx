// frontend/src/components/dashboard/CurrentHoldings.jsx - With Engine Integration
import React, { useState } from 'react';
import {
  Box, Paper, Typography, Card, CardContent, Chip, 
  IconButton, Tooltip, useTheme, alpha, Grid, Divider, Button, CircularProgress,
  Stack
} from '@mui/material';
import { AccountBalance, Info, TrendingUp, TrendingDown, Engineering } from '@mui/icons-material';
import { tradingAPI, engineAPI } from '../../config/api';
import { formatCurrency, formatPrice, formatInstrument, INSTRUMENT_INFO } from './Shared';

const CurrentHoldings = ({ account, prices, portfolio, systemStatus, engineStatus }) => {
  const theme = useTheme();

  // Get engine-tracked trades
  const engineTrades = engineStatus?.openTrades || [];
  const hasEngineTrades = engineTrades.length > 0;

  // --- 1. OPEN POSITION ROW ---
  const PositionRow = ({ position, isEngineTrade = false }) => {
      const instrument = position.instrument || position.symbol;
      const info = INSTRUMENT_INFO[instrument] || {};
      const isBuy = position.side === 'BUY' || position.units > 0;

      // Get current price from prices prop
      const priceData = prices[instrument];
      const currentPrice = priceData?.mid || priceData?.price || 0;
      const entryPrice = position.entryPrice || position.price;

      // Calculate P&L: prefer Oanda's value, but calculate if missing (engine trades)
      const units = Math.abs(position.units || 0);
      let pnl = position.unrealizedPL || position.unrealizedPnL || 0;

      // If no P&L from Oanda and we have prices, calculate it
      // P&L = (currentPrice - entryPrice) * units * direction
      // Note: This is approximate - doesn't include spreads/conversion rates
      if (pnl === 0 && currentPrice && entryPrice && units) {
          const priceDiff = currentPrice - entryPrice;
          const direction = isBuy ? 1 : -1;
          // For AUD account with forex pairs, rough estimate
          pnl = priceDiff * units * direction;
      }

      const isPositive = pnl >= 0;
      
      const [closing, setClosing] = useState(false);

      // Active protective stop display priority:
      // 1) Trailing stop (most protective, dynamic)
      // 2) Breakeven stop (SL moved to entry)
      // 3) Regular stop loss
      const activeProtectiveStop = (() => {
          if (!isEngineTrade) return null;
          if (position.trailingStopPrice) {
              return {
                  label: 'TSL',
                  value: position.trailingStopPrice,
                  color: 'warning.main',
              };
          }
          const stopAtEntry = position.stopLossPrice && position.entryPrice
              ? Math.abs(position.stopLossPrice - position.entryPrice) < 1e-8
              : false;
          if (position.breakevenHit || stopAtEntry) {
              return {
                  label: 'BE',
                  value: position.stopLossPrice || position.entryPrice,
                  color: 'info.main',
              };
          }
          if (position.stopLossPrice) {
              return {
                  label: 'SL',
                  value: position.stopLossPrice,
                  color: 'error.main',
              };
          }
          return null;
      })();

      const handleForceClose = async () => {
          const displayName = formatInstrument(instrument);
          if (!window.confirm(`⚠️ CLOSE ${displayName} POSITION?\nThis will immediately close the position at market price.`)) return;
          setClosing(true);
          try {
              if (isEngineTrade && position.id) {
                  // Close via engine (handles both Oanda and database)
                  await engineAPI.closeTrade(position.id);
              } else {
                  // Close directly via Oanda
                  await tradingAPI.closePosition(position.id);
              }
              // Parent will refresh via socket or polling
          } catch (e) {
              alert(`Close Failed: ${e.message}`);
              setClosing(false);
          }
      };

      return (
        <Card variant="outlined" sx={{ mb: 1.5, bgcolor: alpha(theme.palette.background.paper, 0.4) }}>
            <CardContent sx={{ p: '12px !important' }}>
                {/* Header: Instrument + Side + PnL */}
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                    <Box display="flex" alignItems="center" gap={1}>
                        <Typography variant="body2" sx={{ fontSize: '1.1rem' }}>
                            {info.flag || '💱'}
                        </Typography>
                        <Typography variant="body2" fontWeight="bold">
                            {formatInstrument(instrument)}
                        </Typography>
                        <Chip 
                            label={isBuy ? 'LONG' : 'SHORT'} 
                            color={isBuy ? 'success' : 'error'} 
                            size="small" 
                            sx={{ height: 20, fontSize: '0.65rem', fontWeight: 'bold' }} 
                        />
                        {isEngineTrade && (
                            <Tooltip title="Managed by Trading Engine">
                                <Engineering sx={{ fontSize: 14, color: 'info.main' }} />
                            </Tooltip>
                        )}
                    </Box>
                    <Box textAlign="right">
                        <Typography 
                            variant="body2" 
                            fontWeight="bold" 
                            sx={{ color: isPositive ? theme.palette.success.main : theme.palette.error.main }}
                        >
                            {isPositive ? '+' : ''}{formatCurrency(pnl)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">Unrealized P&L</Typography>
                    </Box>
                </Box>
                
                <Divider sx={{ my: 1, borderColor: alpha(theme.palette.divider, 0.1) }} />
                
                {/* Data Grid */}
                <Grid container spacing={1} alignItems="center">
                    <Grid item xs={3}>
                        <Typography variant="caption" color="text.secondary" display="block">Units</Typography>
                        <Typography variant="caption" fontWeight="bold" sx={{ fontFamily: 'monospace' }}>
                            {units.toLocaleString()}
                        </Typography>
                    </Grid>
                    <Grid item xs={3} textAlign="center">
                        <Typography variant="caption" color="text.secondary" display="block">Entry</Typography>
                        <Typography variant="caption" fontWeight="bold" sx={{ fontFamily: 'monospace' }}>
                            {formatPrice(entryPrice, instrument)}
                        </Typography>
                    </Grid>
                    <Grid item xs={3} textAlign="center">
                        <Typography variant="caption" color="text.secondary" display="block">Current</Typography>
                        <Box display="flex" alignItems="center" justifyContent="center" gap={0.5}>
                            {isPositive ? (
                                <TrendingUp sx={{ fontSize: 12, color: 'success.main' }} />
                            ) : (
                                <TrendingDown sx={{ fontSize: 12, color: 'error.main' }} />
                            )}
                            <Typography 
                                variant="caption" 
                                fontWeight="bold" 
                                sx={{ fontFamily: 'monospace', color: isPositive ? 'success.main' : 'error.main' }}
                            >
                                {formatPrice(currentPrice, instrument)}
                            </Typography>
                        </Box>
                    </Grid>
                    <Grid item xs={3} textAlign="right">
                        <Button 
                            variant="contained" 
                            color="error" 
                            size="small" 
                            onClick={handleForceClose}
                            disabled={closing}
                            sx={{ minWidth: 50, px: 1, py: 0.5, fontSize: '0.65rem', fontWeight: 'bold' }}
                        >
                            {closing ? <CircularProgress size={14} color="inherit" /> : 'CLOSE'}
                        </Button>
                    </Grid>
                </Grid>
                
                {/* Protective Stop / Take Profit Info (for engine trades) */}
                {isEngineTrade && (activeProtectiveStop || position.takeProfitPrice) && (
                    <Box mt={1} pt={1} borderTop={`1px solid ${alpha(theme.palette.divider, 0.1)}`}>
                        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
                            {activeProtectiveStop && (
                                <Chip
                                    size="small"
                                    label={`${activeProtectiveStop.label}: ${formatPrice(activeProtectiveStop.value, instrument)}`}
                                    sx={{
                                        height: 20,
                                        fontSize: '0.68rem',
                                        fontWeight: 'bold',
                                        color: activeProtectiveStop.color,
                                        border: `1px solid ${alpha(theme.palette[activeProtectiveStop.color.split('.')[0]]?.main || theme.palette.text.primary, 0.35)}`,
                                        bgcolor: alpha(theme.palette[activeProtectiveStop.color.split('.')[0]]?.main || theme.palette.text.primary, 0.12),
                                    }}
                                />
                            )}
                            {position.takeProfitPrice && (
                                <Chip
                                    size="small"
                                    label={`TP: ${formatPrice(position.takeProfitPrice, instrument)}`}
                                    sx={{
                                        height: 20,
                                        fontSize: '0.68rem',
                                        fontWeight: 'bold',
                                        color: 'success.main',
                                        border: `1px solid ${alpha(theme.palette.success.main, 0.35)}`,
                                        bgcolor: alpha(theme.palette.success.main, 0.12),
                                    }}
                                />
                            )}
                        </Stack>
                    </Box>
                )}
                
                {/* Margin Info */}
                {position.marginUsed > 0 && (
                    <Box mt={1} pt={1} borderTop={`1px solid ${alpha(theme.palette.divider, 0.1)}`}>
                        <Typography variant="caption" color="text.secondary">
                            Margin: {formatCurrency(position.marginUsed)}
                        </Typography>
                    </Box>
                )}
            </CardContent>
        </Card>
      );
  };

  // --- 2. ACCOUNT SUMMARY SECTION ---
  const AccountSummary = () => {
      if (!portfolio && !account) return null;
      
      const balance = portfolio?.balance || account?.balance || 0;
      const marginUsed = portfolio?.marginUsed || account?.marginUsed || 0;
      const marginAvailable = account?.marginAvailable || (balance - marginUsed);
      const unrealizedPL = portfolio?.unrealizedPnL || account?.unrealizedPL || 0;
      
      return (
        <Card variant="outlined" sx={{ mb: 1.5, bgcolor: alpha(theme.palette.primary.main, 0.05), borderColor: alpha(theme.palette.primary.main, 0.2) }}>
            <CardContent sx={{ p: '12px !important' }}>
                <Box display="flex" alignItems="center" gap={1} mb={1}>
                    <AccountBalance sx={{ fontSize: 18, color: 'primary.main' }} />
                    <Typography variant="body2" fontWeight="bold">Account Summary</Typography>
                </Box>
                
                <Grid container spacing={2}>
                    <Grid item xs={6}>
                        <Typography variant="caption" color="text.secondary" display="block">Balance</Typography>
                        <Typography variant="body2" fontWeight="bold">{formatCurrency(balance)}</Typography>
                    </Grid>
                    <Grid item xs={6}>
                        <Typography variant="caption" color="text.secondary" display="block">Unrealized P&L</Typography>
                        <Typography 
                            variant="body2" 
                            fontWeight="bold"
                            sx={{ color: unrealizedPL >= 0 ? 'success.main' : 'error.main' }}
                        >
                            {unrealizedPL >= 0 ? '+' : ''}{formatCurrency(unrealizedPL)}
                        </Typography>
                    </Grid>
                    <Grid item xs={6}>
                        <Typography variant="caption" color="text.secondary" display="block">Margin Used</Typography>
                        <Typography variant="body2" fontWeight="bold">{formatCurrency(marginUsed)}</Typography>
                    </Grid>
                    <Grid item xs={6}>
                        <Typography variant="caption" color="text.secondary" display="block">Available</Typography>
                        <Typography variant="body2" fontWeight="bold" color="success.main">
                            {formatCurrency(marginAvailable)}
                        </Typography>
                    </Grid>
                </Grid>
            </CardContent>
        </Card>
      );
  };

  // Merge engine trades with portfolio positions (avoid duplicates)
  const allPositions = [...(portfolio?.positions || [])];
  
  // Add engine trades that aren't already in portfolio (by oandaTradeId or instrument)
  const portfolioIds = new Set(allPositions.map(p => p.id));
  const portfolioInstruments = new Set(allPositions.map(p => p.instrument));
  
  engineTrades.forEach(et => {
      // If engine trade has oandaTradeId matching portfolio, skip (already shown)
      if (!portfolioIds.has(et.oandaTradeId) && !portfolioInstruments.has(et.instrument)) {
          allPositions.push({ ...et, isEngineTrade: true });
      }
  });

  return (
    <Paper sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column', bgcolor: alpha(theme.palette.background.paper, 0.6) }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Box display="flex" alignItems="center" gap={1}>
            <Typography variant="h6" fontWeight="bold">Open Positions</Typography>
            {hasEngineTrades && (
                <Tooltip title="Some positions are managed by the Trading Engine">
                    <Chip 
                        icon={<Engineering sx={{ fontSize: 14 }} />}
                        label="Engine"
                        size="small"
                        color="info"
                        sx={{ height: 20, fontSize: '0.65rem' }}
                    />
                </Tooltip>
            )}
        </Box>
        <Tooltip title="Shows open Forex positions and account margin status">
            <IconButton size="small"><Info fontSize="small" /></IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ flexGrow: 1, overflowY: 'auto' }}>
         {/* Account Summary */}
         <AccountSummary />
         
         <Divider sx={{ my: 2 }} />

         <Typography variant="overline" color="text.secondary" sx={{ mb: 1, display: 'block', letterSpacing: 1, fontWeight: 'bold' }}>
            ACTIVE TRADES ({allPositions.length})
         </Typography>
         
         {allPositions.map(p => (
             <PositionRow 
                key={p.id || p.instrument} 
                position={p} 
                isEngineTrade={p.isEngineTrade || engineTrades.some(et => et.instrument === p.instrument)}
             />
         ))}
         
         {!allPositions.length && (
            <Box 
                py={4} 
                display="flex" 
                flexDirection="column" 
                alignItems="center" 
                color="text.secondary"
            >
                <Typography variant="body2" fontWeight="bold">No Open Positions</Typography>
                <Typography variant="caption" sx={{ opacity: 0.6, mt: 0.5 }}>
                    Waiting for trade signals...
                </Typography>
            </Box>
         )}
      </Box>
    </Paper>
  );
};

export default CurrentHoldings;
