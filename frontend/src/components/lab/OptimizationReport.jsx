import React from 'react';
import { Box, Typography, Grid, Button, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Avatar, Chip, useTheme, alpha } from '@mui/material';
import { EmojiEvents, CheckCircle } from '@mui/icons-material';
import { LineChart } from '@mui/x-charts';
import { GlassCard } from '../dashboard/Shared';

const OptimizationReport = ({ report, onApply }) => {
    const theme = useTheme();
    const { rankedAssets, optimizedPortfolio } = report;

    return (
        <GlassCard>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={3} borderBottom={1} borderColor="divider" pb={2}>
                <Box display="flex" alignItems="center" gap={2}>
                    <Avatar sx={{ bgcolor: theme.palette.secondary.main }}><EmojiEvents /></Avatar>
                    <Box>
                        <Typography variant="h6" fontWeight="bold">GENETIC OPTIMIZATION REPORT</Typography>
                        <Typography variant="caption" color="text.secondary">Found {rankedAssets.length} profitable candidates</Typography>
                    </Box>
                </Box>
                <Button variant="contained" color="success" startIcon={<CheckCircle />} onClick={onApply}>
                    APPLY RECOMMENDED
                </Button>
            </Box>

            <Grid container spacing={4}>
                {/* LEADERBOARD */}
                <Grid item xs={12} md={6}>
                    <Typography variant="subtitle2" fontWeight="bold" gutterBottom color="text.secondary">🏆 ASSET LEADERBOARD (Top 10)</Typography>
                    <TableContainer sx={{ maxHeight: 400, border: 1, borderColor: 'divider', borderRadius: 2 }}>
                        <Table size="small" stickyHeader>
                            <TableHead>
                                <TableRow>
                                    <TableCell>Rank</TableCell>
                                    <TableCell>Asset</TableCell>
                                    <TableCell align="right">Score</TableCell>
                                    <TableCell align="right">PnL</TableCell>
                                    <TableCell align="right">Win %</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {rankedAssets.slice(0, 10).map((row, idx) => (
                                    <TableRow key={row.symbol} hover>
                                        <TableCell sx={{ fontWeight: 'bold' }}>#{idx + 1}</TableCell>
                                        <TableCell sx={{ fontWeight: 'bold' }}>{row.symbol.replace('USDT','')}</TableCell>
                                        <TableCell align="right">{row.score.toFixed(1)}</TableCell>
                                        <TableCell align="right" sx={{ color: 'success.main' }}>${row.pnl.toFixed(2)}</TableCell>
                                        <TableCell align="right">{row.winRate.toFixed(0)}%</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </Grid>

                {/* DREAM TEAM STATS */}
                <Grid item xs={12} md={6}>
                    <Typography variant="subtitle2" fontWeight="bold" gutterBottom color="text.secondary">🚀 DREAM TEAM PERFORMANCE</Typography>
                    <Box p={3} border={1} borderColor="divider" borderRadius={2} bgcolor={alpha(theme.palette.secondary.main, 0.05)}>
                        <Grid container spacing={2}>
                            <Grid item xs={6}><Typography variant="caption">Net Profit</Typography><Typography variant="h4" fontWeight="bold" color="success.main">${optimizedPortfolio.stats.netProfit.toFixed(2)}</Typography></Grid>
                            <Grid item xs={6}><Typography variant="caption">Win Rate</Typography><Typography variant="h4" fontWeight="bold">{optimizedPortfolio.stats.winRate.toFixed(1)}%</Typography></Grid>
                            <Grid item xs={12}><Typography variant="caption">Selected Assets</Typography>
                                <Box display="flex" gap={1} flexWrap="wrap" mt={1}>
                                    {optimizedPortfolio.assets.map(a => (
                                        <Chip key={a} label={a.replace('USDT','')} color="secondary" variant="filled" />
                                    ))}
                                </Box>
                            </Grid>
                        </Grid>
                        
                        <Box height={200} mt={2}>
                             <LineChart
                                xAxis={[{ data: optimizedPortfolio.equityCurve.map((_, i) => i), label: 'Time', tickLabelStyle: { fontSize: 0 } }]}
                                series={[{ data: optimizedPortfolio.equityCurve.map(d => d.value), area: true, showMark: false, color: theme.palette.secondary.main }]}
                                height={200}
                            />
                        </Box>
                    </Box>
                </Grid>
            </Grid>
        </GlassCard>
    );
};

export default OptimizationReport;