import React from 'react';
import { Box, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Chip, styled, alpha } from '@mui/material';
import { CalendarToday } from '@mui/icons-material';
import { GlassCard, EmptyState } from './Shared';

const StyledTableCell = styled(TableCell)(({ theme }) => ({ padding: '10px 16px', borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`, fontSize: '0.8rem', fontFamily: '"Roboto Mono", monospace', }));
const HeaderCell = styled(TableCell)(({ theme }) => ({ backgroundColor: alpha(theme.palette.background.paper, 0.2), color: theme.palette.text.secondary, fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 1, borderBottom: `1px solid ${theme.palette.divider}`, }));

const AssetTable = ({ assetStats }) => (
    <GlassCard sx={{ p: 0, overflow: 'hidden' }}>
        <Box p={2} borderBottom={1} borderColor="divider" display="flex" alignItems="center" gap={1}>
            <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">ASSET PERFORMANCE</Typography>
        </Box>
        {Object.keys(assetStats).length > 0 ? (
            <TableContainer sx={{ maxHeight: 400 }}>
                <Table size="small" stickyHeader>
                    <TableHead>
                        <TableRow>
                            <HeaderCell>Asset</HeaderCell>
                            <HeaderCell align="right">Trades</HeaderCell>
                            <HeaderCell align="right">Win Rate</HeaderCell>
                            <HeaderCell align="right">Net PnL</HeaderCell>
                            <HeaderCell align="right">Best Trade</HeaderCell>
                            <HeaderCell align="right">Worst Trade</HeaderCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {Object.entries(assetStats).map(([symbol, stats]) => {
                            const perf = stats.performance || {};
                            return (
                                <TableRow key={symbol} hover sx={{ '&:last-child td, &:last-child th': { border: 0 } }}>
                                    <StyledTableCell sx={{ fontWeight: 'bold' }}>{symbol.replace('USDT', '')}</StyledTableCell>
                                    <StyledTableCell align="right">{perf.totalTrades}</StyledTableCell>
                                    <StyledTableCell align="right">
                                        <Chip label={`${perf.winRate?.toFixed(0)}%`} size="small" color={perf.winRate > 50 ? "success" : "default"} variant={perf.winRate > 50 ? "filled" : "outlined"} sx={{ height: 20, fontSize: '0.7rem', fontWeight: 'bold' }} />
                                    </StyledTableCell>
                                    <StyledTableCell align="right" sx={{ color: perf.totalPnL >= 0 ? 'success.main' : 'error.main', fontWeight: 'bold' }}>{perf.totalPnL >= 0 ? "+" : ""}{perf.totalPnL?.toFixed(2)}</StyledTableCell>
                                    <StyledTableCell align="right" sx={{ color: perf.bestTrade >= 0 ? 'success.light' : 'error.light', fontWeight: 'bold' }}>{perf.bestTrade > 0 ? "+" : ""}${perf.bestTrade?.toFixed(2)}</StyledTableCell>
                                    <StyledTableCell align="right" sx={{ color: perf.worstTrade >= 0 ? 'success.light' : 'error.light', fontWeight: 'bold' }}>{perf.worstTrade > 0 ? "+" : ""}${perf.worstTrade?.toFixed(2)}</StyledTableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </TableContainer>
        ) : (
            <EmptyState height={200} icon={<CalendarToday />} message="No asset data available" />
        )}
    </GlassCard>
);

export default AssetTable;