import React from 'react';
import { Card, CardContent, Grid, Typography, Chip, Box, Tooltip } from '@mui/material';
import {
    ArrowUpward,
    ArrowDownward,
    TrendingFlat,
    HourglassEmpty,
    Block,
    InfoOutlined,
    ReportProblemOutlined,
    DataUsage
} from '@mui/icons-material';

const getSignalChipProps = (signal) => {
    if (!signal) return { label: 'N/A', color: 'default', icon: <HourglassEmpty /> };

    const s = signal.signal || 'HOLD';
    if (s.includes('BUY')) return { label: s.replace('_', ' '), color: 'success', icon: <ArrowUpward /> };
    if (s.includes('SELL')) return { label: s.replace('_', ' '), color: 'error', icon: <ArrowDownward /> };
    if (s.includes('HOLD')) return { label: s.replace('_', ' '), color: 'info', icon: <TrendingFlat /> };
    if (s === 'LOW_VOLATILITY') return { label: 'LOW VOL', color: 'warning', icon: <Block /> };
    if (s === 'COOLDOWN') return { label: 'COOLDOWN', color: 'secondary', icon: <HourglassEmpty /> };
    if (s === 'WEAK_SIGNAL') return { label: 'WEAK', color: 'secondary', icon: <InfoOutlined /> };
    if (s === 'INSUFFICIENT_DATA') return { label: 'BUILDING', color: 'secondary', icon: <DataUsage /> };
    if (s === 'ERROR') return { label: 'ERROR', color: 'error', icon: <ReportProblemOutlined /> };

    return { label: s, color: 'default', icon: <HourglassEmpty /> };
};

const SignalCard = ({ signal }) => {
    if (!signal) return null;

    const chipProps = getSignalChipProps(signal);
    const assetName = signal.symbol.replace('USDT', '');

    return (
        <Card variant="outlined" sx={{ mb: 1 }}>
            <CardContent sx={{ p: '12px !important' }}>
                <Grid container alignItems="center" spacing={1}>
                    {/* Asset */}
                    <Grid item xs={3} sx={{ display: 'flex', flexDirection: 'column' }}>
                        <Typography variant="body2" fontWeight="bold">{assetName}</Typography>
                        <Typography variant="caption" color="text.secondary">
                            {signal.timeframe || '1h'}
                        </Typography>
                    </Grid>

                    {/* Signal Chip */}
                    <Grid item xs={4}>
                        <Tooltip title={signal.message || signal.signal} placement="top">
                            <Chip
                                icon={chipProps.icon}
                                label={chipProps.label}
                                color={chipProps.color}
                                size="small"
                                sx={{ width: '100%', justifyContent: 'flex-start' }}
                            />
                        </Tooltip>
                    </Grid>

                    {/* Strength */}
                    <Grid item xs={2} textAlign="center">
                        <Box>
                            <Typography variant="body2" fontWeight="500">
                                {signal.strength?.toFixed(2) || 'N/A'}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ mt: -0.5, display: 'block' }}>
                                str
                            </Typography>
                        </Box>
                    </Grid>

                    {/* Volatility */}
                    <Grid item xs={3} textAlign="right">
                        <Box>
                            <Typography variant="body2" fontWeight="500">
                                {signal.atrPercent?.toFixed(2) || '...'}%
                            </Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ mt: -0.5, display: 'block' }}>
                                vol
                            </Typography>
                        </Box>
                    </Grid>
                </Grid>
                {signal.message && (
                    <Box mt={1} pl={0.5}>
                      <Typography 
                        variant="caption" 
                        color={signal.signal === 'INSUFFICIENT_DATA' ? 'info.main' : 'textSecondary'}
                        sx={{ 
                          display: 'block',
                          fontSize: '0.7rem',
                          fontStyle: 'italic',
                        }}
                      >
                        {signal.message}
                      </Typography>
                    </Box>
                  )}
            </CardContent>
        </Card>
    );
};

export default SignalCard;