// frontend/src/components/analytics/StrategyWidgets.jsx - Forex Analytics Widgets
import React from 'react';
import {
  Box,
  Typography,
  Avatar,
  Stack,
  Divider,
  LinearProgress,
  Chip,
  useTheme,
  alpha,
} from '@mui/material';
import { PieChart } from '@mui/x-charts';
import {
  ArrowDropUp,
  ArrowDropDown,
  TrendingUp,
  FilterAlt,
  DonutLarge,
  Schedule,
  LightMode,
  CompareArrows,
} from '@mui/icons-material';
import { GlassCard, MetricValue, EmptyState } from '../dashboard/Shared';

// --- KPI CARD ---
export const KPICard = ({ title, value, subtitle, color = 'text.primary', icon }) => {
  const theme = useTheme();
  const isPositive = value && (value.includes('+') || parseFloat(value.replace(/[^0-9.-]/g, '')) > 0);

  // Parse color path (e.g., 'success.main' -> theme.palette.success.main)
  const getColor = (colorPath) => {
    if (!colorPath) return theme.palette.text.primary;
    const parts = colorPath.split('.');
    try {
      return parts.reduce((obj, key) => obj[key], theme.palette);
    } catch {
      return theme.palette.text.primary;
    }
  };

  const themeColor = getColor(color);

  return (
    <GlassCard elevation={0}>
      <Box p={2.5} display="flex" flexDirection="column" justifyContent="space-between" height="100%">
        <Box display="flex" justifyContent="space-between" alignItems="flex-start">
          <Box>
            <Typography
              variant="caption"
              fontWeight="bold"
              color="text.secondary"
              sx={{ textTransform: 'uppercase', letterSpacing: 1 }}
            >
              {title}
            </Typography>
            <MetricValue variant="h4" sx={{ color: themeColor, mt: 1 }}>
              {value}
            </MetricValue>
          </Box>
          <Avatar
            variant="rounded"
            sx={{
              bgcolor: alpha(themeColor, 0.1),
              color: themeColor,
              border: `1px solid ${alpha(themeColor, 0.2)}`,
              width: 40,
              height: 40,
            }}
          >
            {icon}
          </Avatar>
        </Box>
        {subtitle && (
          <Box mt={2} display="flex" alignItems="center" gap={0.5}>
            {isPositive ? (
              <ArrowDropUp color="success" fontSize="small" />
            ) : (
              <ArrowDropDown color="error" fontSize="small" />
            )}
            <Typography variant="body2" color="text.secondary" fontWeight="medium">
              {subtitle}
            </Typography>
          </Box>
        )}
      </Box>
    </GlassCard>
  );
};

// --- SIGNAL QUALITY PIE ---
export const SignalQualityWidget = ({ filterBreakdown, totalSignals, avgStrength }) => {
  const theme = useTheme();

  // Map color names to theme colors
  const getColorForLabel = (colorName) => {
    const colorMap = {
      success: theme.palette.success.main,
      warning: theme.palette.warning.main,
      info: theme.palette.info.main,
      secondary: theme.palette.secondary.main,
      default: theme.palette.grey[600],
      error: theme.palette.error.main,
    };
    return colorMap[colorName] || theme.palette.grey[500];
  };

  const pieData = filterBreakdown.map((item, index) => ({
    id: index,
    value: item.value,
    label: item.label,
    color: getColorForLabel(item.color),
  }));

  return (
    <GlassCard sx={{ p: 2, height: '100%' }}>
      <Box mb={2} display="flex" alignItems="center" justifyContent="space-between">
        <Box display="flex" alignItems="center" gap={1}>
          <FilterAlt color="secondary" fontSize="small" />
          <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">
            SIGNAL FILTERING
          </Typography>
        </Box>
        <Chip
          label={`${totalSignals} signals`}
          size="small"
          sx={{ height: 20, fontSize: '0.65rem' }}
        />
      </Box>

      <Box height={300} display="flex" alignItems="center" justifyContent="center">
        {pieData.length > 0 ? (
          <PieChart
            series={[
              {
                data: pieData,
                innerRadius: 70,
                paddingAngle: 2,
                cornerRadius: 4,
                highlightScope: { faded: 'global', highlighted: 'item' },
              },
            ]}
            margin={{ right: 0, left: 0, top: 0, bottom: 80 }}
            slotProps={{
              legend: {
                direction: 'row',
                position: { vertical: 'bottom', horizontal: 'middle' },
                padding: 0,
                labelStyle: { fill: theme.palette.text.secondary, fontSize: 10 },
              },
            }}
            height={280}
          />
        ) : (
          <EmptyState icon={<FilterAlt />} message="No signal data" />
        )}
      </Box>

      {avgStrength > 0 && (
        <Box mt={2} textAlign="center">
          <Typography variant="caption" color="text.secondary">
            Avg ADX Strength:{' '}
            <Typography component="span" variant="body2" fontWeight="bold" color="primary.main">
              {avgStrength.toFixed(1)}
            </Typography>
          </Typography>
        </Box>
      )}
    </GlassCard>
  );
};

// --- TREND (ADX) ANALYSIS ---
export const TrendAnalysisWidget = ({ totalTrades, adxAnalysis }) => {
  const theme = useTheme();

  if (!adxAnalysis || adxAnalysis.correlation === 'insufficient_data') {
    return (
      <GlassCard sx={{ p: 3, height: '100%' }}>
        <Box mb={2} display="flex" alignItems="center" gap={1}>
          <TrendingUp color="warning" fontSize="small" />
          <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">
            TREND STRENGTH ANALYSIS
          </Typography>
        </Box>
        <EmptyState
          height={200}
          icon={<TrendingUp />}
          message="Insufficient data"
          subMessage="Need more trades with ADX data"
        />
      </GlassCard>
    );
  }

  const { avgAdxWinners, avgAdxLosers, correlation, recommendation, sampleSize } = adxAnalysis;
  const healthPercent =
    avgAdxWinners + avgAdxLosers > 0
      ? (avgAdxWinners / (avgAdxWinners + avgAdxLosers)) * 100
      : 50;

  return (
    <GlassCard sx={{ p: 3, height: '100%' }}>
      <Box mb={2} display="flex" alignItems="center" justifyContent="space-between">
        <Box display="flex" alignItems="center" gap={1}>
          <TrendingUp color="warning" fontSize="small" />
          <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">
            TREND STRENGTH ANALYSIS
          </Typography>
        </Box>
        <Chip
          label={`${sampleSize} trades`}
          size="small"
          sx={{ height: 20, fontSize: '0.65rem' }}
        />
      </Box>

      <Stack spacing={3} mt={2}>
        {/* ADX Comparison */}
        <Box display="flex" justifyContent="space-around" alignItems="center">
          <Box textAlign="center">
            <Typography
              variant="h3"
              color="success.main"
              fontWeight="900"
              sx={{ fontFamily: 'monospace' }}
            >
              {avgAdxWinners.toFixed(0)}
            </Typography>
            <Typography variant="caption" fontWeight="bold" color="text.secondary">
              WINNER ADX
            </Typography>
          </Box>
          <Divider orientation="vertical" flexItem sx={{ height: 40, alignSelf: 'center' }} />
          <Box textAlign="center">
            <Typography
              variant="h3"
              color="error.main"
              fontWeight="900"
              sx={{ fontFamily: 'monospace' }}
            >
              {avgAdxLosers.toFixed(0)}
            </Typography>
            <Typography variant="caption" fontWeight="bold" color="text.secondary">
              LOSER ADX
            </Typography>
          </Box>
        </Box>

        {/* Health Bar */}
        <Box>
          <Box display="flex" justifyContent="space-between" mb={1}>
            <Typography variant="caption" color="text.secondary">
              STRATEGY HEALTH
            </Typography>
            <Typography
              variant="caption"
              color={correlation === 'positive' ? 'success.main' : correlation === 'inverted' ? 'error.main' : 'warning.main'}
            >
              {correlation === 'positive' ? 'OPTIMAL' : correlation === 'inverted' ? 'INVERTED' : 'NEUTRAL'}
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={healthPercent}
            color={correlation === 'positive' ? 'success' : correlation === 'inverted' ? 'error' : 'warning'}
            sx={{ height: 6, borderRadius: 3 }}
          />
        </Box>

        {/* Recommendation */}
        <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
          💡 {recommendation}
        </Typography>
      </Stack>
    </GlassCard>
  );
};

// --- SESSION PERFORMANCE (NEW) ---
export const SessionPerformanceWidget = ({ sessions }) => {
  const theme = useTheme();

  const sessionIcons = {
    Sydney: '🇦🇺',
    Tokyo: '🇯🇵',
    London: '🇬🇧',
    'New York': '🇺🇸',
    'Off-Hours': '🌙',
  };

  const sessionColors = {
    Sydney: theme.palette.info.main,
    Tokyo: theme.palette.error.main,
    London: theme.palette.primary.main,
    'New York': theme.palette.success.main,
    'Off-Hours': theme.palette.grey[600],
  };

  return (
    <GlassCard sx={{ p: 3, height: '100%' }}>
      <Box mb={2} display="flex" alignItems="center" gap={1}>
        <Schedule color="info" fontSize="small" />
        <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">
          SESSION PERFORMANCE
        </Typography>
      </Box>

      {sessions.length > 0 ? (
        <Stack spacing={2} mt={2}>
          {sessions.map((session) => (
            <Box key={session.session}>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={0.5}>
                <Box display="flex" alignItems="center" gap={1}>
                  <Typography variant="body2">{sessionIcons[session.session] || '🌍'}</Typography>
                  <Typography variant="body2" fontWeight="bold">
                    {session.session}
                  </Typography>
                  <Chip
                    label={`${session.trades} trades`}
                    size="small"
                    sx={{ height: 18, fontSize: '0.6rem' }}
                  />
                </Box>
                <Box textAlign="right">
                  <Typography
                    variant="body2"
                    fontWeight="bold"
                    color={session.pnlAud >= 0 ? 'success.main' : 'error.main'}
                  >
                    {session.pnlAud >= 0 ? '+' : ''}A${session.pnlAud.toFixed(2)}
                  </Typography>
                </Box>
              </Box>
              <Box display="flex" alignItems="center" gap={1}>
                <LinearProgress
                  variant="determinate"
                  value={session.winRate}
                  sx={{
                    flex: 1,
                    height: 4,
                    borderRadius: 2,
                    bgcolor: alpha(sessionColors[session.session] || theme.palette.grey[600], 0.2),
                    '& .MuiLinearProgress-bar': {
                      bgcolor: sessionColors[session.session] || theme.palette.grey[600],
                    },
                  }}
                />
                <Typography variant="caption" color="text.secondary" sx={{ minWidth: 35 }}>
                  {session.winRate.toFixed(0)}%
                </Typography>
              </Box>
            </Box>
          ))}
        </Stack>
      ) : (
        <EmptyState icon={<LightMode />} message="No session data" />
      )}
    </GlassCard>
  );
};

// --- SIDE PERFORMANCE (BUY vs SELL) ---
export const SidePerformanceWidget = ({ sidePerformance }) => {
  const buy = sidePerformance?.buy || {};
  const sell = sidePerformance?.sell || {};
  const entryTypes = sidePerformance?.byEntryType || [];
  const sellShare = sidePerformance?.sellSharePercent || 0;

  const getShortHealth = () => {
    const sellTrades = sell.totalTrades || 0;
    if (sellTrades < 3) {
      return { label: 'Insufficient', color: 'default', note: 'Need more SELL sample size' };
    }

    const winRate = sell.winRate || 0;
    const pnl = sell.totalPnLAud || 0;

    if (winRate >= 50 && pnl >= 0) {
      return { label: 'Healthy', color: 'success', note: 'SELL side is contributing positively' };
    }
    if (winRate >= 40 && pnl > -5) {
      return { label: 'Watch', color: 'warning', note: 'Monitor SELL entries and continuation quality' };
    }
    return { label: 'Critical', color: 'error', note: 'SELL side materially underperforming' };
  };

  const shortHealth = getShortHealth();

  const sideRows = [
    {
      side: 'BUY',
      trades: buy.totalTrades || 0,
      winRate: buy.winRate || 0,
      pnl: buy.totalPnLAud || 0,
      color: 'success.main',
    },
    {
      side: 'SELL',
      trades: sell.totalTrades || 0,
      winRate: sell.winRate || 0,
      pnl: sell.totalPnLAud || 0,
      color: 'error.main',
    },
  ];

  return (
    <GlassCard sx={{ p: 3, height: '100%' }}>
      <Box mb={2} display="flex" alignItems="center" justifyContent="space-between">
        <Box display="flex" alignItems="center" gap={1}>
          <CompareArrows color="primary" fontSize="small" />
          <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">
            SIDE PERFORMANCE
          </Typography>
        </Box>
        <Chip
          label={`${sidePerformance?.totalTrades || 0} trades`}
          size="small"
          sx={{ height: 20, fontSize: '0.65rem' }}
        />
      </Box>

      <Stack spacing={1.25}>
        {sideRows.map((row) => (
          <Box
            key={row.side}
            px={1.5}
            py={1}
            borderRadius={1.5}
            sx={{
              border: (theme) => `1px solid ${alpha(theme.palette.divider, 0.12)}`,
              bgcolor: (theme) => alpha(theme.palette.background.paper, 0.25),
            }}
          >
            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Typography variant="body2" fontWeight="bold" color={row.color}>
                {row.side}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {row.trades} trades
              </Typography>
            </Box>
            <Box display="flex" justifyContent="space-between" mt={0.75}>
              <Typography variant="caption" color="text.secondary">
                Win: {row.winRate.toFixed(1)}%
              </Typography>
              <Typography
                variant="caption"
                fontWeight="bold"
                color={row.pnl >= 0 ? 'success.main' : 'error.main'}
              >
                {row.pnl >= 0 ? '+' : ''}A${row.pnl.toFixed(2)}
              </Typography>
            </Box>
          </Box>
        ))}
      </Stack>

      <Divider sx={{ my: 2 }} />

      <Box
        px={1.5}
        py={1}
        mb={1.5}
        borderRadius={1.5}
        sx={{
          border: (theme) => `1px solid ${alpha(theme.palette.divider, 0.12)}`,
          bgcolor: (theme) => alpha(theme.palette.background.paper, 0.25),
        }}
      >
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={0.5}>
          <Typography variant="caption" color="text.secondary" fontWeight="bold">
            SHORT HEALTH
          </Typography>
          <Chip label={shortHealth.label} size="small" color={shortHealth.color} sx={{ height: 18, fontSize: '0.62rem' }} />
        </Box>
        <Typography variant="caption" color="text.secondary">
          SELL share: {sellShare.toFixed(1)}% | {shortHealth.note}
        </Typography>
      </Box>

      <Typography variant="caption" color="text.secondary" fontWeight="bold" sx={{ letterSpacing: 0.6 }}>
        ENTRY TYPE SPLIT
      </Typography>

      {entryTypes.length > 0 ? (
        <Stack spacing={0.75} mt={1.25}>
          {entryTypes.slice(0, 5).map((row) => (
            <Box key={row.entryType} display="flex" justifyContent="space-between" alignItems="center">
              <Typography variant="caption" color="text.secondary">
                {row.entryType}
              </Typography>
              <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                B {row.buyTrades}/{row.buyWinRate.toFixed(0)}% | S {row.sellTrades}/{row.sellWinRate.toFixed(0)}%
              </Typography>
            </Box>
          ))}
        </Stack>
      ) : (
        <EmptyState height={90} icon={<CompareArrows />} message="No side split data" />
      )}
    </GlassCard>
  );
};

// --- EXIT ANALYSIS ---
export const ExitAnalysisWidget = ({ exitAnalysis }) => {
  const theme = useTheme();

  const exitColors = {
    'Take Profit': theme.palette.success.main,
    'Stop Loss': theme.palette.error.main,
    'Trailing Stop': theme.palette.warning.main,
    'Signal Reversal': theme.palette.info.main,
    Manual: theme.palette.secondary.main,
    External: theme.palette.grey[500],
    Unknown: theme.palette.grey[600],
  };

  const pieData =
    exitAnalysis?.breakdown?.map((item, index) => ({
      id: index,
      value: item.count,
      label: item.reason,
      color: exitColors[item.reason] || theme.palette.grey[500],
    })) || [];

  return (
    <GlassCard sx={{ p: 2, height: '100%' }}>
      <Box mb={2} display="flex" alignItems="center" justifyContent="space-between">
        <Box display="flex" alignItems="center" gap={1}>
          <DonutLarge color="info" fontSize="small" />
          <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">
            EXIT STRATEGY
          </Typography>
        </Box>
        {exitAnalysis?.total > 0 && (
          <Chip
            label={`${exitAnalysis.total} exits`}
            size="small"
            sx={{ height: 20, fontSize: '0.65rem' }}
          />
        )}
      </Box>

      <Box height={220} display="flex" alignItems="center" justifyContent="center">
        {pieData.length > 0 ? (
          <PieChart
            series={[
              {
                data: pieData,
                innerRadius: 35,
                paddingAngle: 2,
                cornerRadius: 4,
              },
            ]}
            slotProps={{
              legend: {
                direction: 'column',
                position: { vertical: 'middle', horizontal: 'right' },
                labelStyle: { fill: theme.palette.text.secondary, fontSize: 10 },
              },
            }}
            height={200}
          />
        ) : (
          <EmptyState icon={<DonutLarge />} message="No exit data" />
        )}
      </Box>
    </GlassCard>
  );
};
