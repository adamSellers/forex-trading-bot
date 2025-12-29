import React from 'react';
import { Box, Typography, Grid, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, useTheme } from '@mui/material';
import { LineChart } from '@mui/x-charts';
import { GlassCard } from '../dashboard/Shared';

const SimulationReport = ({ results }) => {
    const theme = useTheme();

    return (
        <GlassCard>
            <Grid container spacing={2} mb={4}>
                <Grid item xs={6} md={3}><Box p={2} border={1} borderRadius={2} borderColor="divider"><Typography variant="caption">NET PnL</Typography><Typography variant="h4" color={results.stats.netProfit>0?"success.main":"error.main"}>${results.stats.netProfit.toFixed(2)}</Typography></Box></Grid>
                <Grid item xs={6} md={3}><Box p={2} border={1} borderRadius={2} borderColor="divider"><Typography variant="caption">WIN RATE</Typography><Typography variant="h4">{results.stats.winRate.toFixed(1)}%</Typography></Box></Grid>
                <Grid item xs={6} md={3}><Box p={2} border={1} borderRadius={2} borderColor="divider"><Typography variant="caption">TRADES</Typography><Typography variant="h4">{results.stats.totalTrades}</Typography></Box></Grid>
                <Grid item xs={6} md={3}><Box p={2} border={1} borderRadius={2} borderColor="divider"><Typography variant="caption">EQUITY</Typography><Typography variant="h4">${results.stats.finalBalance.toFixed(0)}</Typography></Box></Grid>
            </Grid>

            <Box flexGrow={1} minHeight={300} mb={3}>
                <LineChart
                    xAxis={[{ data: results.equityCurve.map((_, i) => i), label: 'Time', tickLabelStyle: { fontSize: 0 } }]}
                    series={[{ data: results.equityCurve.map(d => d.value), area: true, showMark: false, color: theme.palette.primary.main }]}
                    height={300}
                />
            </Box>

            <TableContainer component={Box} sx={{ border: 1, borderColor: 'divider', borderRadius: 2 }}>
                <Table size="small">
                    <TableHead><TableRow><TableCell>Asset</TableCell><TableCell align="right">Trades</TableCell><TableCell align="right">Win %</TableCell><TableCell align="right">PnL</TableCell></TableRow></TableHead>
                    <TableBody>
                        {results.stats.assetStats.map((stat) => (
                            <TableRow key={stat.symbol}>
                                <TableCell fontWeight="bold">{stat.symbol}</TableCell>
                                <TableCell align="right">{stat.trades}</TableCell>
                                <TableCell align="right">{stat.trades > 0 ? ((stat.wins/stat.trades)*100).toFixed(0) : 0}%</TableCell>
                                <TableCell align="right" sx={{ color: stat.pnl > 0 ? 'success.main' : 'error.main' }}>{stat.pnl.toFixed(2)}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
        </GlassCard>
    );
};

export default SimulationReport;