import React from 'react';
import { Paper, Box, Typography, styled, alpha } from '@mui/material';

// --- STYLED COMPONENTS ---
export const GlassCard = styled(Paper)(({ theme }) => ({
  background: alpha(theme.palette.background.paper, 0.05),
  backdropFilter: 'blur(10px)',
  border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  borderRadius: theme.shape.borderRadius * 2,
  boxShadow: '0 4px 30px rgba(0, 0, 0, 0.1)',
  height: '100%',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  transition: 'border-color 0.3s ease',
  '&:hover': {
    borderColor: alpha(theme.palette.primary.main, 0.3),
  }
}));

export const MetricValue = styled(Typography)(() => ({
  fontFamily: '"Roboto Mono", monospace',
  fontWeight: 700,
  letterSpacing: '-1px'
}));

// --- UTILITIES ---
export const currencyFormatter = (value) => {
    if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(1)}k`;
    return `$${value.toFixed(0)}`;
};

// --- SHARED COMPONENTS ---
export const EmptyState = ({ icon, message, height = 250 }) => (
    <Box 
        display="flex" 
        flexDirection="column" 
        alignItems="center" 
        justifyContent="center" 
        height={height}
        color="text.secondary"
        sx={{ opacity: 0.6 }}
    >
        {React.cloneElement(icon, { sx: { fontSize: 48, mb: 2, opacity: 0.5 } })}
        <Typography variant="button" color="text.secondary">{message}</Typography>
    </Box>
);