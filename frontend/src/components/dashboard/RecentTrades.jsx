// frontend/src/components/dashboard/RecentTrades.jsx
import {
    Box, Typography, Chip, Avatar, useTheme, alpha, styled,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow
} from '@mui/material';
import { TrendingUp, TrendingDown, ReceiptLong, AccessTime } from '@mui/icons-material';
import { EmptyState, formatCurrency, formatPrice } from './Shared';

const StyledTableRow = styled(TableRow)(({ theme }) => ({
    '&:nth-of-type(odd)': {
        backgroundColor: alpha(theme.palette.action.hover, 0.05),
    },
    '&:hover': {
        backgroundColor: alpha(theme.palette.primary.main, 0.05),
    },
    '&:last-child td': {
        border: 0,
    },
}));

const StyledTableCell = styled(TableCell)(({ theme }) => ({
    padding: '10px 16px',
    borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
    fontSize: '0.8rem',
    fontFamily: '"Roboto Mono", monospace',
}));

const HeaderCell = styled(TableCell)(({ theme }) => ({
    backgroundColor: alpha(theme.palette.background.paper, 0.8),
    color: theme.palette.text.secondary,
    fontWeight: 700,
    fontSize: '0.7rem',
    textTransform: 'uppercase',
    letterSpacing: 1,
    padding: '10px 16px',
    borderBottom: `1px solid ${theme.palette.divider}`,
}));

export default function RecentTrades({ trades = [] }) {
    const theme = useTheme();

    const getExitReasonColor = (reason) => {
        if (!reason) return 'default';
        const r = reason.toUpperCase();
        if (r.includes('STOP')) return 'error';        // Stop Loss, Trailing Stop
        if (r.includes('TAKE') || r.includes('PROFIT')) return 'success';  // Take Profit
        if (r.includes('SIGNAL') || r.includes('REVERSAL')) return 'warning';  // Signal Reversal
        if (r.includes('MANUAL')) return 'info';       // Manual close
        if (r.includes('EXTERNAL')) return 'default';  // External (closed on Oanda)
        return 'default';
    };

    if (!trades || trades.length === 0) {
        return (
            <EmptyState 
                icon={<ReceiptLong sx={{ fontSize: 64 }} />}
                message="NO TRADE HISTORY"
                subMessage="Completed trades will appear here"
            />
        );
    }

    return (
        <TableContainer component={Box} sx={{ height: '100%', overflow: 'auto' }}>
            <Table stickyHeader size="small">
                <TableHead>
                    <TableRow>
                        <HeaderCell>Pair</HeaderCell>
                        <HeaderCell>Side</HeaderCell>
                        <HeaderCell align="right">Entry</HeaderCell>
                        <HeaderCell align="right">Exit</HeaderCell>
                        <HeaderCell align="center">Reason</HeaderCell>
                        <HeaderCell align="right">P&L</HeaderCell>
                        <HeaderCell align="right">Time</HeaderCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {trades.map((trade, index) => {
                        if (!trade) return null;

                        const instrument = trade.instrument || trade.symbol || '---';
                        const displayName = instrument.replace('_', '/').replace('USDT', '');
                        const side = trade.side || 'BUY';
                        const isBuy = side === 'BUY';
                        const isOpen = trade.isOpen || trade.is_open;
                        const pnl = parseFloat(trade.pnlAud || trade.pnl || 0);
                        const pnlPips = parseFloat(trade.pnlPips || trade.pnl_pips || 0);
                        const isWin = pnl >= 0;
                        const entryPrice = trade.entryPrice || trade.entry_price || trade.price;
                        const exitPrice = trade.exitPrice || trade.exit_price;
                        const exitReason = trade.exitReason || trade.exit_reason;
                        const timestamp = new Date(trade.exitTime || trade.exit_time || trade.entryTime || trade.entry_time || trade.timestamp);

                        return (
                            <StyledTableRow key={trade.id || trade.tradeId || index}>
                                {/* Pair */}
                                <StyledTableCell>
                                    <Box display="flex" alignItems="center" gap={1}>
                                        <Avatar
                                            variant="rounded"
                                            sx={{
                                                width: 24,
                                                height: 24,
                                                bgcolor: alpha(
                                                    isOpen 
                                                        ? theme.palette.primary.main 
                                                        : isWin 
                                                            ? theme.palette.success.main 
                                                            : theme.palette.error.main, 
                                                    0.1
                                                ),
                                                color: isOpen 
                                                    ? 'primary.main' 
                                                    : isWin 
                                                        ? 'success.main' 
                                                        : 'error.main'
                                            }}
                                        >
                                            {isOpen 
                                                ? <AccessTime sx={{ fontSize: 14 }} />
                                                : isWin 
                                                    ? <TrendingUp sx={{ fontSize: 14 }} />
                                                    : <TrendingDown sx={{ fontSize: 14 }} />
                                            }
                                        </Avatar>
                                        <Typography variant="body2" fontWeight="bold">
                                            {displayName}
                                        </Typography>
                                    </Box>
                                </StyledTableCell>

                                {/* Side */}
                                <StyledTableCell>
                                    <Chip
                                        label={side}
                                        size="small"
                                        color={isBuy ? 'success' : 'error'}
                                        variant="outlined"
                                        sx={{ height: 20, fontSize: '0.65rem', fontWeight: 'bold' }}
                                    />
                                </StyledTableCell>

                                {/* Entry Price */}
                                <StyledTableCell align="right">
                                    {formatPrice(entryPrice, instrument)}
                                </StyledTableCell>

                                {/* Exit Price */}
                                <StyledTableCell align="right" sx={{ color: 'text.secondary' }}>
                                    {!isOpen && exitPrice ? formatPrice(exitPrice, instrument) : '---'}
                                </StyledTableCell>

                                {/* Exit Reason */}
                                <StyledTableCell align="center">
                                    {!isOpen && exitReason ? (
                                        <Chip
                                            label={exitReason.replace(/_/g, ' ')}
                                            size="small"
                                            color={getExitReasonColor(exitReason)}
                                            sx={{ height: 20, fontSize: '0.6rem', fontWeight: 'bold' }}
                                        />
                                    ) : isOpen ? (
                                        <Chip
                                            label="OPEN"
                                            size="small"
                                            color="primary"
                                            sx={{ height: 20, fontSize: '0.6rem', fontWeight: 'bold' }}
                                        />
                                    ) : (
                                        <Typography variant="caption" color="text.disabled">---</Typography>
                                    )}
                                </StyledTableCell>

                                {/* P&L */}
                                <StyledTableCell align="right">
                                    {!isOpen ? (
                                        <Box>
                                            <Typography
                                                variant="body2"
                                                fontWeight="bold"
                                                sx={{ color: isWin ? 'success.main' : 'error.main' }}
                                            >
                                                {isWin ? '+' : ''}{formatCurrency(pnl)}
                                            </Typography>
                                            {pnlPips !== 0 && (
                                                <Typography
                                                    variant="caption"
                                                    sx={{ 
                                                        color: isWin ? 'success.main' : 'error.main',
                                                        opacity: 0.8
                                                    }}
                                                >
                                                    {pnlPips >= 0 ? '+' : ''}{pnlPips.toFixed(1)} pips
                                                </Typography>
                                            )}
                                        </Box>
                                    ) : (
                                        <Typography variant="caption" color="text.secondary">---</Typography>
                                    )}
                                </StyledTableCell>

                                {/* Time */}
                                <StyledTableCell align="right">
                                    <Box display="flex" flexDirection="column" alignItems="flex-end">
                                        <Typography variant="caption" sx={{ fontSize: '0.7rem' }}>
                                            {timestamp.toLocaleTimeString()}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.6rem' }}>
                                            {timestamp.toLocaleDateString()}
                                        </Typography>
                                    </Box>
                                </StyledTableCell>
                            </StyledTableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </TableContainer>
    );
}