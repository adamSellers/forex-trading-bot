// frontend/src/components/lab/SimulationReport.jsx - V3.2.6 LIVE PARITY UPDATE
import React, { useState } from 'react';
import { 
    Box, Typography, Grid, Table, TableBody, TableCell, TableContainer, 
    TableHead, TableRow, useTheme, Chip, Stack, Tooltip, IconButton,
    Collapse, alpha, Divider
} from '@mui/material';
import { LineChart } from '@mui/x-charts';
import { 
    TrendingUp, TrendingDown, Info, ExpandMore, ExpandLess,
    AttachMoney, Speed, Repeat, Security
} from '@mui/icons-material';
import { GlassCard } from '../dashboard/Shared';

// Stat Card Component
const StatCard = ({ label, value, subValue, color, icon, tooltip }) => {
    const theme = useTheme();
    const content = (
        <Box 
            p={2} 
            border={1} 
            borderRadius={2} 
            borderColor="divider"
            bgcolor={alpha(theme.palette.background.paper, 0.3)}
            height="100%"
        >
            <Box display="flex" justifyContent="space-between" alignItems="flex-start">
                <Typography variant="caption" color="text.secondary" fontWeight="bold">
                    {label}
                </Typography>
                {icon && React.cloneElement(icon, { fontSize: 'small', sx: { opacity: 0.5 } })}
            </Box>
            <Typography 
                variant="h4" 
                fontWeight="bold" 
                color={color || 'text.primary'}
                sx={{ mt: 0.5 }}
            >
                {value}
            </Typography>
            {subValue && (
                <Typography variant="caption" color="text.secondary">
                    {subValue}
                </Typography>
            )}
        </Box>
    );
    
    return tooltip ? (
        <Tooltip title={tooltip} arrow>
            {content}
        </Tooltip>
    ) : content;
};

const SimulationReport = ({ results }) => {
    const theme = useTheme();
    const [showDetails, setShowDetails] = useState(false);
    
    const { stats, equityCurve, configUsed } = results;
    const isProfit = stats.netProfit > 0;
    
    // Calculate additional metrics
    const avgPnlPerTrade = stats.totalTrades > 0 ? stats.netProfit / stats.totalTrades : 0;
    const continuationPct = stats.totalTrades > 0 && stats.continuationTrades 
        ? ((stats.continuationTrades / stats.totalTrades) * 100).toFixed(1) 
        : '0';

    return (
        <GlassCard>
            {/* HEADER */}
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                <Box display="flex" alignItems="center" gap={2}>
                    {isProfit ? (
                        <TrendingUp sx={{ fontSize: 40, color: 'success.main' }} />
                    ) : (
                        <TrendingDown sx={{ fontSize: 40, color: 'error.main' }} />
                    )}
                    <Box>
                        <Typography variant="h5" fontWeight="900">
                            SIMULATION COMPLETE
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                            {stats.totalTrades} trades executed over simulation period
                        </Typography>
                    </Box>
                </Box>
                
                {/* Config Verification Badge */}
                {configUsed && (
                    <Tooltip title="Click to see simulation parameters">
                        <Chip 
                            icon={<Info />}
                            label="LIVE PARITY MODE"
                            color="primary"
                            variant="outlined"
                            size="small"
                            onClick={() => setShowDetails(!showDetails)}
                            sx={{ cursor: 'pointer' }}
                        />
                    </Tooltip>
                )}
            </Box>

            {/* PRIMARY STATS */}
            <Grid container spacing={2} mb={3}>
                <Grid item xs={6} md={3}>
                    <StatCard 
                        label="NET P&L"
                        value={`$${stats.netProfit.toFixed(2)}`}
                        color={isProfit ? 'success.main' : 'error.main'}
                        subValue={`${((stats.netProfit / stats.initialBalance) * 100).toFixed(1)}% return`}
                    />
                </Grid>
                <Grid item xs={6} md={3}>
                    <StatCard 
                        label="WIN RATE"
                        value={`${stats.winRate.toFixed(1)}%`}
                        color={stats.winRate >= 50 ? 'success.main' : 'warning.main'}
                    />
                </Grid>
                <Grid item xs={6} md={3}>
                    <StatCard 
                        label="TOTAL TRADES"
                        value={stats.totalTrades}
                        subValue={`Avg: $${avgPnlPerTrade.toFixed(2)}/trade`}
                    />
                </Grid>
                <Grid item xs={6} md={3}>
                    <StatCard 
                        label="FINAL EQUITY"
                        value={`$${stats.finalBalance.toFixed(0)}`}
                        subValue={`Started: $${stats.initialBalance}`}
                    />
                </Grid>
            </Grid>

            {/* SECONDARY STATS (New in V3.2.6) */}
            {(stats.totalFees !== undefined || stats.continuationTrades !== undefined) && (
                <Grid container spacing={2} mb={3}>
                    {stats.totalFees !== undefined && (
                        <Grid item xs={6} md={3}>
                            <StatCard 
                                label="TOTAL FEES"
                                value={`$${stats.totalFees.toFixed(2)}`}
                                icon={<AttachMoney />}
                                tooltip="Realistic fee simulation based on Binance tier"
                                subValue={stats.avgFeePerTrade ? `Avg: $${stats.avgFeePerTrade.toFixed(3)}/trade` : undefined}
                            />
                        </Grid>
                    )}
                    {stats.continuationTrades !== undefined && (
                        <Grid item xs={6} md={3}>
                            <StatCard 
                                label="CONTINUATION"
                                value={stats.continuationTrades}
                                icon={<Repeat />}
                                tooltip="Trades entered via continuation logic (RSI cooled after blocked flip)"
                                subValue={`${continuationPct}% of entries`}
                            />
                        </Grid>
                    )}
                    {stats.freshFlipTrades !== undefined && (
                        <Grid item xs={6} md={3}>
                            <StatCard 
                                label="FRESH FLIPS"
                                value={stats.freshFlipTrades}
                                icon={<TrendingUp />}
                                tooltip="Trades entered on exact SuperTrend flip candle"
                            />
                        </Grid>
                    )}
                </Grid>
            )}

            {/* CONFIG DETAILS PANEL */}
            <Collapse in={showDetails}>
                <Box 
                    mb={3} 
                    p={2} 
                    bgcolor={alpha(theme.palette.info.main, 0.05)} 
                    borderRadius={2}
                    border={1}
                    borderColor={alpha(theme.palette.info.main, 0.2)}
                >
                    <Box display="flex" alignItems="center" gap={1} mb={2}>
                        <Info color="info" fontSize="small" />
                        <Typography variant="subtitle2" fontWeight="bold">
                            Simulation Configuration
                        </Typography>
                    </Box>
                    <Grid container spacing={2}>
                        {configUsed?.feeTier && (
                            <Grid item xs={6} md={3}>
                                <Stack direction="row" alignItems="center" gap={1}>
                                    <AttachMoney fontSize="small" color="action" />
                                    <Box>
                                        <Typography variant="caption" color="text.secondary">Fee Tier</Typography>
                                        <Typography variant="body2" fontWeight="bold">
                                            {configUsed.feeTier.replace('_', ' ').toUpperCase()}
                                        </Typography>
                                    </Box>
                                </Stack>
                            </Grid>
                        )}
                        {configUsed?.slippageEnabled !== undefined && (
                            <Grid item xs={6} md={3}>
                                <Stack direction="row" alignItems="center" gap={1}>
                                    <Speed fontSize="small" color="action" />
                                    <Box>
                                        <Typography variant="caption" color="text.secondary">Slippage</Typography>
                                        <Typography variant="body2" fontWeight="bold">
                                            {configUsed.slippageEnabled ? `${(configUsed.slippagePct * 100).toFixed(2)}%` : 'OFF'}
                                        </Typography>
                                    </Box>
                                </Stack>
                            </Grid>
                        )}
                        {configUsed?.continuationEnabled !== undefined && (
                            <Grid item xs={6} md={3}>
                                <Stack direction="row" alignItems="center" gap={1}>
                                    <Repeat fontSize="small" color="action" />
                                    <Box>
                                        <Typography variant="caption" color="text.secondary">Continuation</Typography>
                                        <Typography variant="body2" fontWeight="bold">
                                            {configUsed.continuationEnabled ? 'ENABLED' : 'OFF'}
                                        </Typography>
                                    </Box>
                                </Stack>
                            </Grid>
                        )}
                        {configUsed?.maxExposure !== undefined && (
                            <Grid item xs={6} md={3}>
                                <Stack direction="row" alignItems="center" gap={1}>
                                    <Security fontSize="small" color="action" />
                                    <Box>
                                        <Typography variant="caption" color="text.secondary">Max Exposure</Typography>
                                        <Typography variant="body2" fontWeight="bold">
                                            {(configUsed.maxExposure * 100).toFixed(0)}%
                                        </Typography>
                                    </Box>
                                </Stack>
                            </Grid>
                        )}
                        {configUsed?.stopLossType && (
                            <Grid item xs={6} md={3}>
                                <Stack direction="row" alignItems="center" gap={1}>
                                    <TrendingDown fontSize="small" color="action" />
                                    <Box>
                                        <Typography variant="caption" color="text.secondary">Stop Type</Typography>
                                        <Typography variant="body2" fontWeight="bold">
                                            {configUsed.stopLossType}
                                        </Typography>
                                    </Box>
                                </Stack>
                            </Grid>
                        )}
                        {configUsed?.rsiOverbought && (
                            <Grid item xs={6} md={3}>
                                <Box>
                                    <Typography variant="caption" color="text.secondary">RSI Overbought</Typography>
                                    <Typography variant="body2" fontWeight="bold">
                                        {configUsed.rsiOverbought}
                                    </Typography>
                                </Box>
                            </Grid>
                        )}
                    </Grid>
                </Box>
            </Collapse>

            {/* EQUITY CURVE */}
            <Box mb={3}>
                <Typography variant="subtitle2" fontWeight="bold" color="text.secondary" mb={1}>
                    EQUITY CURVE
                </Typography>
                <Box 
                    sx={{ 
                        height: 280, 
                        border: 1, 
                        borderColor: 'divider', 
                        borderRadius: 2,
                        p: 1 
                    }}
                >
                    <LineChart
                        xAxis={[{ 
                            data: equityCurve.map((_, i) => i), 
                            label: 'Time', 
                            tickLabelStyle: { fontSize: 0 } 
                        }]}
                        series={[{ 
                            data: equityCurve.map(d => d.value), 
                            area: true, 
                            showMark: false, 
                            color: isProfit ? theme.palette.success.main : theme.palette.error.main,
                            label: 'Portfolio Value'
                        }]}
                        height={260}
                        margin={{ left: 60, right: 20, top: 20, bottom: 30 }}
                    />
                </Box>
            </Box>

            {/* ASSET BREAKDOWN */}
            <Typography variant="subtitle2" fontWeight="bold" color="text.secondary" mb={1}>
                ASSET PERFORMANCE
            </Typography>
            <TableContainer 
                component={Box} 
                sx={{ 
                    border: 1, 
                    borderColor: 'divider', 
                    borderRadius: 2,
                    maxHeight: 300
                }}
            >
                <Table size="small" stickyHeader>
                    <TableHead>
                        <TableRow>
                            <TableCell sx={{ fontWeight: 'bold', bgcolor: 'background.paper' }}>Asset</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 'bold', bgcolor: 'background.paper' }}>Trades</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 'bold', bgcolor: 'background.paper' }}>Win %</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 'bold', bgcolor: 'background.paper' }}>P&L</TableCell>
                            {stats.assetStats?.[0]?.continuationTrades !== undefined && (
                                <TableCell align="right" sx={{ fontWeight: 'bold', bgcolor: 'background.paper' }}>
                                    <Tooltip title="Continuation entries">
                                        <Box display="flex" alignItems="center" justifyContent="flex-end" gap={0.5}>
                                            <Repeat fontSize="small" />
                                        </Box>
                                    </Tooltip>
                                </TableCell>
                            )}
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {stats.assetStats.map((stat) => {
                            const winRate = stat.trades > 0 ? ((stat.wins / stat.trades) * 100) : 0;
                            return (
                                <TableRow key={stat.symbol} hover>
                                    <TableCell>
                                        <Typography fontWeight="bold" fontSize="0.875rem">
                                            {stat.symbol.replace('USDT', '')}
                                        </Typography>
                                    </TableCell>
                                    <TableCell align="right">{stat.trades}</TableCell>
                                    <TableCell align="right">
                                        <Chip 
                                            label={`${winRate.toFixed(0)}%`}
                                            size="small"
                                            color={winRate >= 50 ? 'success' : 'default'}
                                            variant={winRate >= 50 ? 'filled' : 'outlined'}
                                            sx={{ minWidth: 50, fontWeight: 'bold' }}
                                        />
                                    </TableCell>
                                    <TableCell 
                                        align="right" 
                                        sx={{ 
                                            color: stat.pnl > 0 ? 'success.main' : 'error.main',
                                            fontWeight: 'bold'
                                        }}
                                    >
                                        ${stat.pnl.toFixed(2)}
                                    </TableCell>
                                    {stat.continuationTrades !== undefined && (
                                        <TableCell align="right">
                                            {stat.continuationTrades > 0 ? (
                                                <Chip 
                                                    label={stat.continuationTrades}
                                                    size="small"
                                                    color="info"
                                                    variant="outlined"
                                                />
                                            ) : '-'}
                                        </TableCell>
                                    )}
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </TableContainer>
        </GlassCard>
    );
};

export default SimulationReport;