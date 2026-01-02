// frontend/src/components/analytics/PairPerformance.jsx - Forex Pair Performance Table
import React from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  LinearProgress,
  styled,
  alpha,
  useTheme,
} from '@mui/material';
import { CurrencyExchange, TrendingUp, TrendingDown } from '@mui/icons-material';
import { GlassCard, EmptyState, formatInstrument } from '../dashboard/Shared';

// Styled table cells
const StyledTableCell = styled(TableCell)(({ theme }) => ({
  padding: '12px 16px',
  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  fontSize: '0.8rem',
  fontFamily: '"Roboto Mono", monospace',
}));

const HeaderCell = styled(TableCell)(({ theme }) => ({
  backgroundColor: alpha(theme.palette.background.paper, 0.3),
  color: theme.palette.text.secondary,
  fontWeight: 700,
  fontSize: '0.7rem',
  textTransform: 'uppercase',
  letterSpacing: 1,
  borderBottom: `1px solid ${theme.palette.divider}`,
  padding: '10px 16px',
}));

// Pair flag/icon mapping
const PAIR_FLAGS = {
  AUD_USD: { flag: '🇦🇺', name: 'Aussie Dollar' },
  EUR_USD: { flag: '🇪🇺', name: 'Euro' },
  GBP_USD: { flag: '🇬🇧', name: 'British Pound' },
  USD_JPY: { flag: '🇯🇵', name: 'Yen' },
  NZD_USD: { flag: '🇳🇿', name: 'Kiwi Dollar' },
  USD_CAD: { flag: '🇨🇦', name: 'Canadian Dollar' },
  USD_CHF: { flag: '🇨🇭', name: 'Swiss Franc' },
};

const PairPerformance = ({ pairStats }) => {
  const theme = useTheme();

  // Sort by total P/L descending
  const sortedStats = [...(pairStats || [])].sort((a, b) => b.totalPnLAud - a.totalPnLAud);

  // Calculate best performing pair for highlight
  const bestPair = sortedStats.length > 0 ? sortedStats[0].instrument : null;
  const worstPair = sortedStats.length > 0 ? sortedStats[sortedStats.length - 1].instrument : null;

  return (
    <GlassCard sx={{ p: 0, overflow: 'hidden' }}>
      {/* Header */}
      <Box
        p={2}
        borderBottom={1}
        borderColor="divider"
        display="flex"
        alignItems="center"
        justifyContent="space-between"
      >
        <Box display="flex" alignItems="center" gap={1}>
          <CurrencyExchange color="primary" fontSize="small" />
          <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">
            CURRENCY PAIR PERFORMANCE
          </Typography>
        </Box>
        {sortedStats.length > 0 && (
          <Box display="flex" gap={1}>
            <Chip
              icon={<TrendingUp sx={{ fontSize: 14 }} />}
              label={formatInstrument(bestPair)}
              size="small"
              color="success"
              variant="outlined"
              sx={{ height: 22, fontSize: '0.65rem' }}
            />
            {worstPair !== bestPair && (
              <Chip
                icon={<TrendingDown sx={{ fontSize: 14 }} />}
                label={formatInstrument(worstPair)}
                size="small"
                color="error"
                variant="outlined"
                sx={{ height: 22, fontSize: '0.65rem' }}
              />
            )}
          </Box>
        )}
      </Box>

      {/* Table */}
      {sortedStats.length > 0 ? (
        <TableContainer sx={{ maxHeight: 400 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <HeaderCell>Pair</HeaderCell>
                <HeaderCell align="center">Trades</HeaderCell>
                <HeaderCell align="center">Win Rate</HeaderCell>
                <HeaderCell align="right">Net P/L (AUD)</HeaderCell>
                <HeaderCell align="right">Pips</HeaderCell>
                <HeaderCell align="right">Best Trade</HeaderCell>
                <HeaderCell align="right">Worst Trade</HeaderCell>
                <HeaderCell align="center">Avg ADX</HeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedStats.map((stats) => {
                const pairInfo = PAIR_FLAGS[stats.instrument] || { flag: '🌍', name: stats.instrument };
                const isTopPerformer = stats.instrument === bestPair && stats.totalPnLAud > 0;
                const isBottomPerformer = stats.instrument === worstPair && stats.totalPnLAud < 0;

                return (
                  <TableRow
                    key={stats.instrument}
                    hover
                    sx={{
                      '&:last-child td, &:last-child th': { border: 0 },
                      bgcolor: isTopPerformer
                        ? alpha(theme.palette.success.main, 0.05)
                        : isBottomPerformer
                        ? alpha(theme.palette.error.main, 0.05)
                        : 'transparent',
                    }}
                  >
                    {/* Pair */}
                    <StyledTableCell>
                      <Box display="flex" alignItems="center" gap={1}>
                        <Typography variant="body2">{pairInfo.flag}</Typography>
                        <Box>
                          <Typography variant="body2" fontWeight="bold">
                            {formatInstrument(stats.instrument)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {pairInfo.name}
                          </Typography>
                        </Box>
                      </Box>
                    </StyledTableCell>

                    {/* Trades */}
                    <StyledTableCell align="center">
                      <Chip
                        label={stats.totalTrades}
                        size="small"
                        sx={{ height: 20, fontSize: '0.7rem', minWidth: 32 }}
                      />
                    </StyledTableCell>

                    {/* Win Rate */}
                    <StyledTableCell align="center">
                      <Box display="flex" alignItems="center" gap={1}>
                        <LinearProgress
                          variant="determinate"
                          value={stats.winRate || 0}
                          color={stats.winRate > 50 ? 'success' : stats.winRate > 40 ? 'warning' : 'error'}
                          sx={{ width: 50, height: 6, borderRadius: 3 }}
                        />
                        <Typography
                          variant="body2"
                          fontWeight="bold"
                          color={stats.winRate > 50 ? 'success.main' : 'warning.main'}
                        >
                          {stats.winRate?.toFixed(0)}%
                        </Typography>
                      </Box>
                    </StyledTableCell>

                    {/* Net P/L */}
                    <StyledTableCell
                      align="right"
                      sx={{
                        color: stats.totalPnLAud >= 0 ? 'success.main' : 'error.main',
                        fontWeight: 'bold',
                      }}
                    >
                      {stats.totalPnLAud >= 0 ? '+' : ''}A${stats.totalPnLAud?.toFixed(2)}
                    </StyledTableCell>

                    {/* Pips */}
                    <StyledTableCell
                      align="right"
                      sx={{
                        color: stats.totalPnLPips >= 0 ? 'success.light' : 'error.light',
                      }}
                    >
                      {stats.totalPnLPips >= 0 ? '+' : ''}{stats.totalPnLPips?.toFixed(1)}
                    </StyledTableCell>

                    {/* Best Trade */}
                    <StyledTableCell
                      align="right"
                      sx={{ color: 'success.main', fontWeight: 'bold' }}
                    >
                      +A${stats.bestTradeAud?.toFixed(2) || '0.00'}
                    </StyledTableCell>

                    {/* Worst Trade */}
                    <StyledTableCell
                      align="right"
                      sx={{ color: 'error.main', fontWeight: 'bold' }}
                    >
                      A${stats.worstTradeAud?.toFixed(2) || '0.00'}
                    </StyledTableCell>

                    {/* Avg ADX */}
                    <StyledTableCell align="center">
                      <Chip
                        label={stats.avgSignalStrength?.toFixed(0) || 'N/A'}
                        size="small"
                        color={
                          stats.avgSignalStrength > 25
                            ? 'success'
                            : stats.avgSignalStrength > 20
                            ? 'warning'
                            : 'default'
                        }
                        variant="outlined"
                        sx={{ height: 20, fontSize: '0.65rem' }}
                      />
                    </StyledTableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <Box p={4}>
          <EmptyState
            icon={<CurrencyExchange sx={{ fontSize: 48 }} />}
            message="No pair performance data"
            subMessage="Complete trades to see performance by currency pair"
          />
        </Box>
      )}
    </GlassCard>
  );
};

export default PairPerformance;