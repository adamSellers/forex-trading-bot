import React from 'react';
import { Box, Typography, LinearProgress, CircularProgress } from '@mui/material';
import { Science } from '@mui/icons-material';
import { GlassCard } from '../dashboard/Shared';

export const LoadingState = ({ message, percent, isOptimizing }) => (
    <GlassCard sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
        <CircularProgress size={60} thickness={4} sx={{ mb: 3 }} color={isOptimizing ? "secondary" : "primary"} />
        <Typography variant="h6" fontWeight="bold" gutterBottom>{isOptimizing ? "RUNNING GENETIC SCREENER" : "SIMULATION RUNNING"}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{message}</Typography>
        <Box width="60%">
            <LinearProgress variant="determinate" value={percent} sx={{ height: 8, borderRadius: 4 }} color={isOptimizing ? "secondary" : "primary"} />
        </Box>
    </GlassCard>
);

export const EmptyState = () => (
    <GlassCard sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, opacity: 0.5 }}>
        <Science sx={{ fontSize: 100, mb: 2 }} />
        <Typography variant="h5" fontWeight="bold">READY TO SIMULATE</Typography>
        <Typography>Configure manually or use Auto-Optimize</Typography>
    </GlassCard>
);