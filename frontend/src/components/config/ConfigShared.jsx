// frontend/src/components/config/ConfigShared.jsx
import React from 'react';
import { Box, Typography, Avatar, styled, alpha, useTheme } from '@mui/material';

// ============================================
// STYLED COMPONENTS
// ============================================
export const GlassCard = styled(Box)(({ theme }) => ({
  background: alpha(theme.palette.background.paper, 0.05),
  backdropFilter: 'blur(10px)',
  border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  borderRadius: theme.shape.borderRadius * 2,
  boxShadow: '0 4px 30px rgba(0, 0, 0, 0.1)',
  padding: theme.spacing(3),
  transition: 'border-color 0.3s ease',
  '&:hover': {
    borderColor: alpha(theme.palette.primary.main, 0.3),
  }
}));

export const SectionHeader = ({ icon, title, subtitle }) => {
  const theme = useTheme();
  return (
    <Box display="flex" alignItems="center" gap={2} mb={3}>
      <Avatar variant="rounded" sx={{ bgcolor: alpha(theme.palette.primary.main, 0.1), color: theme.palette.primary.main }}>
        {icon}
      </Avatar>
      <Box>
        <Typography variant="h6" fontWeight="bold" lineHeight={1.2}>{title}</Typography>
        {subtitle && <Typography variant="caption" color="text.secondary">{subtitle}</Typography>}
      </Box>
    </Box>
  );
};

// ============================================
// CONSTANTS
// ============================================

// Forex pairs available for trading
export const SUPPORTED_INSTRUMENTS = ['AUD_USD', 'EUR_USD', 'GBP_USD', 'USD_JPY'];

// Trading session times (UTC)
export const TRADING_SESSIONS = {
  sydney: { name: 'Sydney', start: 21, end: 6, color: '#4CAF50' },
  tokyo: { name: 'Tokyo', start: 0, end: 9, color: '#f44336' },
  london: { name: 'London', start: 7, end: 16, color: '#2196F3' },
  newyork: { name: 'New York', start: 12, end: 21, color: '#FF9800' }
};

// ============================================
// DEFAULT CONFIGURATION
// ============================================
export const DEFAULT_CONFIG = {
  // General
  maxCapitalAtRisk: 500,
  enableTrading: false,
  maxOpenPositions: 2,
  logLevel: 'info',
  
  // Strategy
  strategy: 'supertrend_momentum',
  timeframe: '15m',
  signalCooldown: 60,
  
  // SuperTrend Settings
  supertrendPeriod: 10,
  supertrendMultiplier: 3.0,
  
  // Entry Filters
  enableAdxFilter: true,
  minAdx: 22,
  enableRsiFilter: true,
  rsiOverbought: 75,
  rsiOversold: 30,
  
  // Continuation Entry
  enableContinuationEntry: true,
  continuationWindowMs: 4 * 60 * 60 * 1000,
  continuationRsiThreshold: 70,
  continuationMaxPriceDeviation: 0.02,
  
  // Risk Management
  riskPerTrade: 0.02,
  maxPortfolioExposure: 0.50,
  
  // Position Sizing
  positionSizeMethod: 'RISK',
  fixedPositionUnits: 1000,
  leverage: 10,
  maxLeverage: 30,
  
  // Stop Loss
  stopLossType: 'ATR',
  stopLossPips: 30,
  stopLossAtrMultiplier: 1.5,
  
  // Take Profit (% of account balance)
  enableTakeProfit: true,
  takeProfitPercent: 0.06,
  
  // Trailing Stop
  enableTrailingStops: true,
  trailingStopPips: 25,
  trailingStopActivationPips: 20,
  
  // Trading Sessions
  enableSessionFilter: false,
  activeSessions: ['sydney', 'tokyo', 'london', 'newyork'],
  
  // Assets
  assets: ['AUD_USD', 'EUR_USD'],
  
  // Notifications
  enableEmailAlerts: false,
  alertEmail: '',
};

// ============================================
// HELPER FUNCTIONS
// ============================================
export const msToHours = (ms) => ms / (60 * 60 * 1000);
export const hoursToMs = (hours) => hours * 60 * 60 * 1000;