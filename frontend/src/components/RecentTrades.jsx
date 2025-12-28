// frontend/src/components/RecentTrades.jsx
import React from 'react';
import PropTypes from 'prop-types';
import { 
    Typography, Chip, Box, useTheme, alpha, styled,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    Avatar
} from '@mui/material';
import { 
    TrendingUp, TrendingDown, ReceiptLong, CheckCircle, 
    Cancel, Flag, AccessTime 
} from '@mui/icons-material';

// --- STYLED COMPONENTS (Matching TradingSignals style) ---
const StyledTableRow = styled(TableRow)(({ theme }) => ({
    '&:nth-of-type(odd)': {
        backgroundColor: alpha(theme.palette.action.hover, 0.05),
    },
    '&:hover': {
        backgroundColor: alpha(theme.palette.primary.main, 0.05),
        cursor: 'default'
    },
    '&:last-child td, &:last-child th': {
        border: 0,
    },
}));

const StyledTableCell = styled(TableCell)(({ theme }) => ({
    padding: '8px 16px',
    height: 48,
    borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
    fontSize: '0.8rem',
    fontFamily: '"Roboto Mono", monospace',
}));

const HeaderCell = styled(TableCell)(({ theme }) => ({
    backgroundColor: alpha(theme.palette.background.paper, 0.5),
    backdropFilter: 'blur(5px)',
    color: theme.palette.text.secondary,
    fontWeight: 700,
    fontSize: '0.7rem',
    textTransform: 'uppercase',
    letterSpacing: 1,
    padding: '8px 16px',
    borderBottom: `1px solid ${theme.palette.divider}`,
}));

const RecentTrades = ({ trades }) => {
  const theme = useTheme();

  const formatUSDT = (value) => {
    const numericValue = Number(value);
    if (isNaN(numericValue)) return '---';
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numericValue);
  };

  const formatPrice = (value) => {
      const num = Number(value);
      if (!num) return '---';
      return num < 1 ? num.toFixed(5) : num.toFixed(2);
  };

  // --- LOADING STATE ---
  if (!Array.isArray(trades)) {
    return (
        <Box p={4} textAlign="center" color="text.secondary">
            <Typography variant="caption">Loading Trade History...</Typography>
        </Box>
    );
  }

  // --- EMPTY STATE ---
  if (trades.length === 0) {
      return (
        <Box height="100%" display="flex" flexDirection="column" alignItems="center" justifyContent="center" color="text.secondary" p={4}>
            <ReceiptLong sx={{ fontSize: 48, opacity: 0.2, mb: 1 }} />
            <Typography variant="button" color="text.secondary">NO TRADE HISTORY</Typography>
        </Box>
      );
  }

  // --- HELPERS ---
  const getReasonColor = (reason) => {
      if (!reason) return 'default';
      const r = reason.toUpperCase();
      if (r.includes('STOP')) return 'error';      // Stop Loss
      if (r.includes('TAKE')) return 'success';    // Take Profit
      if (r.includes('TREND')) return 'warning';   // Trend Flip
      if (r.includes('MANUAL')) return 'info';     // Manual Close
      return 'default';
  };

  return (
    <TableContainer component={Box} sx={{ height: '100%', overflow: 'auto' }}>
        <Table stickyHeader size="small">
            <TableHead>
                <TableRow>
                    <HeaderCell>Asset</HeaderCell>
                    <HeaderCell>Status</HeaderCell>
                    <HeaderCell align="right">Entry Price</HeaderCell>
                    <HeaderCell align="right">Exit Price</HeaderCell>
                    <HeaderCell align="center">Exit Reason</HeaderCell>
                    <HeaderCell align="right">Realized PnL</HeaderCell>
                    <HeaderCell align="right">Time</HeaderCell>
                </TableRow>
            </TableHead>
            <TableBody>
                {trades.slice(0, 50).map((trade, index) => {
                    if (!trade) return null;

                    // Data Normalization
                    const isClosed = trade.status === 'CLOSED' || (trade.pnl !== undefined && trade.pnl !== null);
                    const symbol = (trade.symbol || '---').replace('USDT', '');
                    const entryPrice = trade.entryPrice || trade.price; // Fallback to 'price' if entryPrice missing
                    const exitPrice = trade.exitPrice;
                    const pnl = Number(trade.pnl || 0);
                    const isWin = pnl >= 0;
                    const exitReason = trade.exitReason || trade.exit_reason; // Handle camel or snake case
                    const timestamp = new Date(trade.exitTime || trade.timestamp);

                    return (
                        <StyledTableRow key={trade.id || index}>
                            {/* 1. ASSET */}
                            <StyledTableCell>
                                <Box display="flex" alignItems="center" gap={1.5}>
                                    <Avatar 
                                        variant="rounded"
                                        sx={{ 
                                            width: 24, height: 24, 
                                            bgcolor: alpha(isWin ? theme.palette.success.main : theme.palette.error.main, 0.1),
                                            color: isWin ? 'success.main' : 'error.main',
                                            border: `1px solid ${alpha(isWin ? theme.palette.success.main : theme.palette.error.main, 0.2)}`
                                        }}
                                    >
                                        {isClosed ? (isWin ? <TrendingUp fontSize="small" /> : <TrendingDown fontSize="small" />) : <AccessTime fontSize="small" />}
                                    </Avatar>
                                    <Typography variant="body2" fontWeight="bold">{symbol}</Typography>
                                </Box>
                            </StyledTableCell>

                            {/* 2. STATUS */}
                            <StyledTableCell>
                                <Chip 
                                    label={isClosed ? "CLOSED" : "OPEN"} 
                                    size="small" 
                                    color={isClosed ? "default" : "primary"}
                                    variant={isClosed ? "outlined" : "filled"}
                                    sx={{ height: 20, fontSize: '0.65rem', fontWeight: 'bold' }}
                                />
                            </StyledTableCell>

                            {/* 3. ENTRY */}
                            <StyledTableCell align="right">
                                ${formatPrice(entryPrice)}
                            </StyledTableCell>

                            {/* 4. EXIT */}
                            <StyledTableCell align="right" sx={{ color: 'text.secondary' }}>
                                {exitPrice ? `$${formatPrice(exitPrice)}` : '-'}
                            </StyledTableCell>

                            {/* 5. REASON */}
                            <StyledTableCell align="center">
                                {exitReason ? (
                                    <Chip 
                                        label={exitReason.replace(/_/g, ' ')} 
                                        size="small" 
                                        color={getReasonColor(exitReason)}
                                        sx={{ height: 20, fontSize: '0.65rem', fontWeight: 'bold' }}
                                    />
                                ) : (
                                    <Typography variant="caption" color="text.disabled">-</Typography>
                                )}
                            </StyledTableCell>

                            {/* 6. PNL */}
                            <StyledTableCell align="right">
                                {isClosed ? (
                                    <Box>
                                        <Typography 
                                            variant="body2" 
                                            fontWeight="bold" 
                                            sx={{ color: isWin ? 'success.main' : 'error.main' }}
                                        >
                                            {isWin ? '+' : ''}{formatUSDT(pnl)}
                                        </Typography>
                                        {/* Optional % if available, otherwise calculate approx */}
                                        <Typography variant="caption" sx={{ color: isWin ? 'success.main' : 'error.main', opacity: 0.7 }}>
                                            {entryPrice ? `${((pnl / (entryPrice * trade.quantity)) * 100).toFixed(2)}%` : ''}
                                        </Typography>
                                    </Box>
                                ) : (
                                    <Typography variant="caption" color="text.secondary">Active</Typography>
                                )}
                            </StyledTableCell>

                            {/* 7. TIME */}
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
};

RecentTrades.propTypes = {
  trades: PropTypes.array
};

export default RecentTrades;