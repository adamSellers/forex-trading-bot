// frontend/src/components/lab/LabStates.jsx
import React from 'react';
import { Box, Typography, LinearProgress, CircularProgress, Avatar, Stack, alpha, useTheme } from '@mui/material';
import { Science, AutoMode, Memory, HourglassEmpty } from '@mui/icons-material';
import { GlassCard } from '../dashboard/Shared';

export const LoadingState = ({ message, percent, isOptimizing }) => {
    const theme = useTheme();
    const activeColor = isOptimizing ? theme.palette.secondary.main : theme.palette.primary.main;

    return (
        <GlassCard sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
            
            {/* 1. Animated Icon Container */}
            <Box position="relative" mb={4}>
                {/* Outer Spinner */}
                <CircularProgress 
                    size={80} 
                    thickness={2} 
                    sx={{ 
                        color: activeColor, 
                        opacity: 0.3,
                        position: 'absolute',
                        left: -15,
                        top: -15,
                        animationDuration: '3s'
                    }} 
                />
                
                {/* Center Icon */}
                <Avatar 
                    sx={{ 
                        width: 50, height: 50, 
                        bgcolor: alpha(activeColor, 0.1),
                        color: activeColor,
                        boxShadow: `0 0 20px ${alpha(activeColor, 0.2)}`,
                        border: `1px solid ${alpha(activeColor, 0.3)}`
                    }}
                >
                    {isOptimizing ? <AutoMode fontSize="large" sx={{ animation: 'spin 4s linear infinite' }} /> : <Science fontSize="large" />}
                </Avatar>
            </Box>

            {/* 2. Header Text */}
            <Typography variant="h5" fontWeight="900" gutterBottom sx={{ letterSpacing: -0.5 }}>
                {isOptimizing ? "GENETIC OPTIMIZATION" : "SIMULATION RUNNING"}
            </Typography>
            
            {/* 3. Terminal-style Status Message */}
            <Typography 
                variant="body2" 
                sx={{ 
                    mb: 3, 
                    fontFamily: '"Roboto Mono", monospace', 
                    color: isOptimizing ? 'secondary.main' : 'primary.main',
                    bgcolor: alpha(activeColor, 0.05), 
                    px: 2, py: 0.5, 
                    borderRadius: 1,
                    border: `1px dashed ${alpha(activeColor, 0.2)}`,
                    minWidth: 300,
                    textAlign: 'center'
                }}
            >
                {">"} {message || "Initializing process..."}
            </Typography>

            {/* 4. Progress Bar with Label */}
            <Box width="60%" display="flex" alignItems="center" gap={2}>
                <Box flexGrow={1}>
                    <LinearProgress 
                        variant="determinate" 
                        value={percent} 
                        sx={{ 
                            height: 8, 
                            borderRadius: 4,
                            backgroundColor: alpha(theme.palette.text.primary, 0.05),
                            '& .MuiLinearProgress-bar': {
                                borderRadius: 4,
                                backgroundColor: activeColor,
                                transition: 'transform 0.2s linear'
                            }
                        }} 
                    />
                </Box>
                <Typography variant="caption" fontWeight="bold" sx={{ fontFamily: 'monospace', minWidth: 35 }}>
                    {Math.round(percent)}%
                </Typography>
            </Box>

            {/* 5. Context Badge (Optimizing Only) */}
            {isOptimizing && (
                <Stack direction="row" alignItems="center" gap={1} mt={4} sx={{ opacity: 0.5 }}>
                    <Memory fontSize="small" />
                    <Typography variant="caption" fontWeight="bold">
                        Processing 15 Assets • 120 Days History
                    </Typography>
                </Stack>
            )}

        </GlassCard>
    );
};

export const EmptyState = () => {
    const theme = useTheme();
    return (
        <GlassCard sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, opacity: 0.6 }}>
            <Science sx={{ fontSize: 80, mb: 2, color: theme.palette.text.disabled }} />
            <Typography variant="h5" fontWeight="900" color="text.secondary">READY TO SIMULATE</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Configure parameters manually or use <Box component="span" fontWeight="bold" color="secondary.main">Auto-Optimize</Box>
            </Typography>
        </GlassCard>
    );
};