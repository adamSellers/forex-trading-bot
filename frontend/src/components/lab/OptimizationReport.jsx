// frontend/src/components/lab/OptimizationReport.jsx
import React from 'react';
import { 
    Box, Typography, Grid, Button, Table, TableBody, TableCell, 
    TableContainer, TableHead, TableRow, Avatar, Chip, 
    useTheme, alpha, Tooltip, Stack 
} from '@mui/material';
import { EmojiEvents, CheckCircle, Info, PieChart } from '@mui/icons-material';
import { LineChart } from '@mui/x-charts';
import { GlassCard } from '../dashboard/Shared';

const OptimizationReport = ({ report, onApply }) => {
    const theme = useTheme();
    const { rankedAssets, optimizedPortfolio } = report;
    
    // Calculate the split percentage (e.g., 4 assets = 25%)
    const assetCount = optimizedPortfolio.assets.length;
    const splitPercent = Math.round(100 / Math.max(assetCount, 1));

    return (
        <GlassCard>
            {/* HEADER */}
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={3} borderBottom={1} borderColor="divider" pb={2}>
                <Box display="flex" alignItems="center" gap={2}>
                    <Avatar variant="rounded" sx={{ bgcolor: alpha(theme.palette.secondary.main, 0.1), color: theme.palette.secondary.main }}>
                        <EmojiEvents />
                    </Avatar>
                    <Box>
                        <Typography variant="h6" fontWeight="bold" lineHeight={1.2}>GENETIC OPTIMIZATION REPORT</Typography>
                        <Typography variant="caption" color="text.secondary">Found {rankedAssets.length} profitable candidates from universe</Typography>
                    </Box>
                </Box>
                <Button 
                    variant="contained" 
                    color="success" 
                    startIcon={<CheckCircle />} 
                    onClick={onApply}
                    sx={{ fontWeight: 'bold', boxShadow: theme.shadows[4] }}
                >
                    APPLY RECOMMENDED
                </Button>
            </Box>

            <Grid container spacing={4}>
                
                {/* LEFT: LEADERBOARD (ALL-IN SCORES) */}
                <Grid item xs={12} md={6}>
                    <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
                        <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">🏆 INDIVIDUAL PERFORMANCE</Typography>
                        <Chip label="100% ALLOCATION TEST" size="small" color="default" variant="outlined" sx={{ fontSize: '0.65rem', height: 20, fontWeight: 'bold' }} />
                    </Box>
                    
                    <TableContainer sx={{ maxHeight: 400, border: 1, borderColor: 'divider', borderRadius: 2 }}>
                        <Table size="small" stickyHeader>
                            <TableHead>
                                <TableRow>
                                    <TableCell sx={{ bgcolor: 'background.paper' }}>Rank</TableCell>
                                    <TableCell sx={{ bgcolor: 'background.paper' }}>Asset</TableCell>
                                    <TableCell align="right" sx={{ bgcolor: 'background.paper' }}>Score</TableCell>
                                    <TableCell align="right" sx={{ bgcolor: 'background.paper' }}>
                                        <Tooltip title="Profit if 100% of capital was traded on ONLY this asset (Isolated Test)">
                                            <Box display="flex" alignItems="center" justifyContent="flex-end" gap={0.5} sx={{ cursor: 'help' }}>
                                                PnL <Info sx={{ fontSize: 14, opacity: 0.5 }} />
                                            </Box>
                                        </Tooltip>
                                    </TableCell>
                                    <TableCell align="right" sx={{ bgcolor: 'background.paper' }}>Win %</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {rankedAssets.slice(0, 10).map((row, idx) => (
                                    <TableRow key={row.symbol} hover>
                                        <TableCell sx={{ fontWeight: 'bold' }}>#{idx + 1}</TableCell>
                                        <TableCell sx={{ fontWeight: 'bold' }}>{row.symbol.replace('USDT','')}</TableCell>
                                        <TableCell align="right">{row.score.toFixed(1)}</TableCell>
                                        <TableCell align="right" sx={{ color: 'success.main', fontWeight: 'bold' }}>${row.pnl.toFixed(0)}</TableCell>
                                        <TableCell align="right">{row.winRate.toFixed(0)}%</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </Grid>

                {/* RIGHT: DREAM TEAM (DIVERSIFIED) */}
                <Grid item xs={12} md={6}>
                     <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
                        <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">🚀 DREAM TEAM PORTFOLIO</Typography>
                        <Chip 
                            icon={<PieChart sx={{ fontSize: '12px !important' }} />} 
                            label={`SPLIT: ${splitPercent}% EACH`} 
                            size="small" 
                            color="secondary" 
                            variant="outlined" 
                            sx={{ fontSize: '0.65rem', height: 20, fontWeight: 'bold' }} 
                        />
                    </Box>

                    <Box p={3} border={1} borderColor="divider" borderRadius={2} bgcolor={alpha(theme.palette.secondary.main, 0.05)}>
                        <Grid container spacing={2}>
                            <Grid item xs={6}>
                                <Typography variant="caption" color="text.secondary">Net Profit (Combined)</Typography>
                                <Typography variant="h4" fontWeight="bold" color="success.main">
                                    ${optimizedPortfolio.stats.netProfit.toFixed(2)}
                                </Typography>
                            </Grid>
                            <Grid item xs={6}>
                                <Typography variant="caption" color="text.secondary">Win Rate (Avg)</Typography>
                                <Typography variant="h4" fontWeight="bold">
                                    {optimizedPortfolio.stats.winRate.toFixed(1)}%
                                </Typography>
                            </Grid>
                            
                            <Grid item xs={12}>
                                <Stack direction="row" spacing={1} alignItems="center" mb={1}>
                                    <Typography variant="caption" fontWeight="bold">Selected Mix:</Typography>
                                    <Tooltip title={`Capital is split ${splitPercent}% to each asset. Profit is lower than "All-In" because exposure is diluted.`}>
                                        <Info sx={{ fontSize: 16, opacity: 0.5, cursor: 'help' }} />
                                    </Tooltip>
                                </Stack>
                                <Box display="flex" gap={1} flexWrap="wrap">
                                    {optimizedPortfolio.assets.map(a => (
                                        <Chip 
                                            key={a} 
                                            label={a.replace('USDT','')} 
                                            size="small"
                                            color="secondary" 
                                            variant="filled" 
                                            sx={{ fontWeight: 'bold' }}
                                        />
                                    ))}
                                </Box>
                            </Grid>
                        </Grid>
                        
                        <Box height={200} mt={3}>
                             <LineChart
                                xAxis={[{ data: optimizedPortfolio.equityCurve.map((_, i) => i), label: 'Time', tickLabelStyle: { fontSize: 0 } }]}
                                series={[{ 
                                    data: optimizedPortfolio.equityCurve.map(d => d.value), 
                                    area: true, 
                                    showMark: false, 
                                    color: theme.palette.secondary.main,
                                    label: 'Portfolio Equity'
                                }]}
                                height={200}
                                margin={{ left: 50, right: 10, top: 10, bottom: 20 }}
                            />
                        </Box>
                    </Box>
                </Grid>
            </Grid>
        </GlassCard>
    );
};

export default OptimizationReport;