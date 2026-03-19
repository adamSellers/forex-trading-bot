// frontend/src/components/config/ConfigShared.jsx
import React from 'react';
import { Box, Typography, Avatar, styled, alpha, useTheme } from '@mui/material';
import tradingConfigDefaults from '../../../../shared/tradingConfigDefaults.json';

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

const cloneDefaults = () => JSON.parse(JSON.stringify(tradingConfigDefaults));

// Forex pairs available for trading
export const SUPPORTED_INSTRUMENTS = [...(tradingConfigDefaults.assets || [])];

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
export const createDefaultConfig = () => {
  const defaults = cloneDefaults();

  return {
    ...defaults,
    signalCooldown: Number.isFinite(Number(defaults.signalCooldown))
      ? Number(defaults.signalCooldown) / 1000
      : 60,
  };
};

export const DEFAULT_CONFIG = createDefaultConfig();

// ============================================
// HELPER FUNCTIONS
// ============================================
export const msToHours = (ms) => ms / (60 * 60 * 1000);
export const hoursToMs = (hours) => hours * 60 * 60 * 1000;
