import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Container,
  Divider,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import {
  AutoGraph,
  CompareArrows,
  ExpandMore,
  PlayArrow,
  Refresh,
  RestartAlt,
  Stop,
  Timeline,
} from '@mui/icons-material';
import { runtimeAPI, socket, strategiesAPI } from '../config/api';
import { GlassCard } from './dashboard/Shared';
import EquityChart from './analytics/EquityChart';
import RecentTrades from './dashboard/RecentTrades';
import { extractRunTelemetry, extractSignalTelemetry } from './analytics/signalTelemetry';

const PAPER_REFRESH_INTERVAL_MS = 30000;
const PAPER_EVENT_NAMES = [
  'runtimeRunsChanged',
  'paperRunUpdated',
  'paperRuntimeReset',
  'liveSelectionUpdated',
  'tradeOpened',
  'tradeClosed',
];
const PAPER_COMPARISON_STEPS = [
  'Confirm the shadow baseline matches the current live selection before judging any candidate.',
  'Launch one or more candidate runs from the candidate launcher below.',
  'Click a run card to focus it and inspect its exact signals, trades, equity, and config snapshot.',
  'Use Promote to Live only when you are comfortable pausing the engine and flattening any current live positions.',
  'Reset a candidate or the shadow baseline when you want a fresh paper sample from the current market context.',
  'Stop a candidate when you are finished comparing it or when the run is no longer useful.',
];
const PERFORMANCE_WATCHLIST = [
  'Compare every candidate against the shadow baseline first, not just against zero.',
  'Watch equity-curve shape and drawdown behavior, not only the latest unrealized PnL.',
  'Check Recent Signals to see whether the strategy is generating actionable setups or mostly waiting states.',
  'Check Recent Trades for frequency, hold time, and whether results come from repeatable behavior instead of one outsized winner.',
  'Use Analytics with Mode = Candidate Paper and then narrow by Strategy or Run for cleaner comparisons.',
];
const PROMOTION_CHECKLIST = [
  'Sample size is large enough to trust the result.',
  'Performance is better than or at least competitive with the shadow baseline.',
  'Behavior is stable across pairs and sessions, not concentrated in one narrow pocket.',
  'Signal reasons still make sense when you inspect the detailed run feed.',
];
const CANDIDATE_WATCH_NOTES = {
  mean_reversion:
    'Watch for steady win-rate behavior, contained drawdowns, and clean performance during quieter ranging conditions.',
  range_breakout:
    'Watch whether breakouts actually follow through after entry instead of snapping back into the range.',
  stochastic_divergence:
    'Watch signal quality and reversal follow-through. Frequent early fades usually show up in profit factor quickly.',
  squeeze_play:
    'Watch whether post-compression releases turn into sustained directional moves rather than repeated false starts.',
  timesfm_directional:
    'Watch whether raw forecast-led entries produce enough quality setups to justify deeper model-driven logic beyond the overlay path.',
  counter_signal_reversion:
    'Watch whether fading the aggregate source stack reliably catches exhaustion, or simply fights strong trend agreement.',
  signal_following:
    'Watch whether following the aggregate source stack improves signal confirmation without concentrating too heavily in one source strategy.',
};

const formatCurrency = (value) =>
  new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

const formatDateTime = (value) => {
  if (!value) return 'Waiting';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Waiting';
  return date.toLocaleString([], {
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  });
};

const formatRunId = (value) => (value ? String(value).slice(0, 12) : 'unassigned');

const getRunStatusColor = (status) => {
  if (status === 'active') return 'success';
  if (status === 'managing_only') return 'warning';
  if (status === 'stopped') return 'default';
  return 'default';
};

const isCandidateStrategy = (strategy = {}) => strategy.runtimeStatus === 'candidate';

const getStrategyLabel = (strategyKey, catalog = []) =>
  catalog.find((strategy) => strategy.key === strategyKey)?.label || strategyKey;

const isRunInCurrentSelection = (run, liveSelection = null) =>
  Boolean(
    run?.selectionId &&
      liveSelection?.selectionId &&
      run.selectionId === liveSelection.selectionId
  );

const isPromotedCandidateRun = (run) =>
  run?.metadata?.promotionStatus === 'promoted_to_live';

const isPromotedToCurrentSelection = (run, liveSelection = null) =>
  isPromotedCandidateRun(run) &&
  Boolean(
    run?.metadata?.promotedToSelectionId &&
      liveSelection?.selectionId &&
      run.metadata.promotedToSelectionId === liveSelection.selectionId
  );

const getCandidateRunBadges = (run, liveSelection = null) => {
  const badges = [];

  if (isPromotedToCurrentSelection(run, liveSelection)) {
    badges.push({
      label: 'Promoted Source',
      color: 'warning',
    });
  } else if (isPromotedCandidateRun(run)) {
    badges.push({
      label: 'Previously Promoted',
      color: 'warning',
    });
  }

  if (liveSelection?.selectionId && run?.selectionId !== liveSelection.selectionId) {
    badges.push({
      label: 'Older Selection',
      color: 'default',
    });
  }

  return badges;
};

const getCandidateRunNotice = (run, liveSelection = null) => {
  if (isPromotedToCurrentSelection(run, liveSelection)) {
    return `This candidate supplied the current live config on ${formatDateTime(
      run?.metadata?.promotedAt
    )}. The paired shadow run is now the paper mirror for this live selection.`;
  }

  if (liveSelection?.selectionId && run?.selectionId !== liveSelection.selectionId) {
    return 'This candidate belongs to an older live selection. Keep it for historical comparison, not as the active live mirror.';
  }

  return null;
};

const compareCandidateRuns = (left, right, liveSelection = null) => {
  const leftCurrentSelection = isRunInCurrentSelection(left, liveSelection) ? 1 : 0;
  const rightCurrentSelection = isRunInCurrentSelection(right, liveSelection) ? 1 : 0;
  if (leftCurrentSelection !== rightCurrentSelection) {
    return rightCurrentSelection - leftCurrentSelection;
  }

  const leftActive = left?.status === 'active' ? 1 : 0;
  const rightActive = right?.status === 'active' ? 1 : 0;
  if (leftActive !== rightActive) {
    return rightActive - leftActive;
  }

  return Number(right?.startedAt || 0) - Number(left?.startedAt || 0);
};

const isRunPromotable = (run, catalog = [], liveSelection = null) => {
  if (run?.mode !== 'paper_candidate') {
    return false;
  }

  if (isPromotedToCurrentSelection(run, liveSelection)) {
    return false;
  }

  const strategy = catalog.find((entry) => entry.key === run.strategy);
  if (!strategy) {
    return true;
  }

  return strategy?.metadata?.supportsLive !== false;
};

const buildCandidateLabel = (strategy, runs = []) => {
  const siblingCount = runs.filter(
    (run) => run.strategy === strategy.key && run.mode === 'paper_candidate'
  ).length;
  return `${strategy.label} #${siblingCount + 1}`;
};

const SummaryMetric = ({ label, value, tone = 'text.primary' }) => (
  <Box minWidth={110}>
    <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 0.8 }}>
      {label}
    </Typography>
    <Typography variant="subtitle2" sx={{ color: tone, fontWeight: 700 }}>
      {value}
    </Typography>
  </Box>
);

const formatPercent = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${parsed.toFixed(1)}%` : '--';
};

const getWinRate = (summary = {}) => {
  const provided = Number(summary?.winRate);
  if (Number.isFinite(provided)) {
    return provided;
  }

  const closedTrades = Number(summary?.closedTradeCount ?? summary?.totalTrades ?? 0);
  const winners = Number(summary?.winningTrades ?? 0);
  return closedTrades > 0 ? (winners / closedTrades) * 100 : null;
};

const TelemetryMetric = ({ label, value, tone = 'text.primary' }) => (
  <Box minWidth={118}>
    <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 0.8 }}>
      {label}
    </Typography>
    <Typography
      variant="caption"
      sx={{
        display: 'block',
        color: tone,
        fontWeight: 800,
        fontFamily: '"Roboto Mono", monospace',
      }}
    >
      {value || '--'}
    </Typography>
  </Box>
);

const RunTelemetryStrip = ({ run }) => {
  const telemetry = extractRunTelemetry(run || {});

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: '1fr 1fr',
          md: 'repeat(5, minmax(116px, 1fr))',
        },
        gap: 1,
      }}
    >
      <TelemetryMetric
        label="Expected Edge"
        value={telemetry.hasEdge ? telemetry.edgeLabel : telemetry.edgeGateLabel}
        tone={telemetry.edgeTone}
      />
      <TelemetryMetric
        label="Cost Gate"
        value={telemetry.hasCost ? telemetry.spreadLabel : telemetry.costGateLabel}
        tone={telemetry.costTone}
      />
      <TelemetryMetric
        label="Regime"
        value={telemetry.regimeLabel}
        tone={telemetry.regimeTone}
      />
      <TelemetryMetric label="Fresh Flip" value={telemetry.freshFlip.label} />
      <Box minWidth={118}>
        <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 0.8 }}>
          Broker
        </Typography>
        <Box mt={0.35}>
          <Chip
            size="small"
            label={telemetry.broker.label}
            color={telemetry.broker.color}
            variant={telemetry.broker.feedsBroker ? 'filled' : 'outlined'}
            sx={{ height: 20, fontSize: '0.62rem', fontWeight: 800 }}
          />
        </Box>
      </Box>
    </Box>
  );
};

const RunComparisonTable = ({ shadowRun, candidateRuns = [], strategyCatalog = [] }) => {
  const theme = useTheme();
  const rows = [shadowRun, ...candidateRuns].filter(Boolean);

  if (rows.length === 0) {
    return null;
  }

  return (
    <GlassCard sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1}>
          <Box>
            <Typography variant="overline" sx={{ letterSpacing: 1.4, color: 'primary.main', fontWeight: 800 }}>
              Run Comparison
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>
              Baseline, Candidates, Gates
            </Typography>
          </Box>
          <Chip size="small" label={`${rows.length} runs`} variant="outlined" />
        </Stack>

        <TableContainer sx={{ maxHeight: 420 }}>
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell>Run</TableCell>
                <TableCell>Mode</TableCell>
                <TableCell align="right">Realized</TableCell>
                <TableCell align="right">Win</TableCell>
                <TableCell align="right">Signals</TableCell>
                <TableCell>Expected Edge</TableCell>
                <TableCell>Cost</TableCell>
                <TableCell>Regime</TableCell>
                <TableCell>Broker</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((run) => {
                const telemetry = extractRunTelemetry(run);
                const summary = run.summary || {};
                const closedTrades = summary.closedTradeCount ?? summary.totalTrades ?? 0;
                const signalCount =
                  summary.totalSignals ??
                  summary.signalCount ??
                  (summary.lastSignal ? 1 : 0);

                return (
                  <TableRow key={run.runId} hover>
                    <TableCell sx={{ borderColor: alpha(theme.palette.divider, 0.08) }}>
                      <Typography variant="body2" sx={{ fontWeight: 800 }}>
                        {run.metadata?.displayName || getStrategyLabel(run.strategy, strategyCatalog)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: '"Roboto Mono", monospace' }}>
                        {formatRunId(run.runId)}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ borderColor: alpha(theme.palette.divider, 0.08) }}>
                      <Chip
                        size="small"
                        label={String(run.mode || 'unknown').replace(/_/g, ' ')}
                        variant="outlined"
                        sx={{ height: 20, fontSize: '0.62rem' }}
                      />
                    </TableCell>
                    <TableCell align="right" sx={{ borderColor: alpha(theme.palette.divider, 0.08) }}>
                      <Typography
                        variant="caption"
                        sx={{
                          color: Number(summary.realizedPnlAud || 0) >= 0 ? 'success.main' : 'error.main',
                          fontFamily: '"Roboto Mono", monospace',
                          fontWeight: 800,
                        }}
                      >
                        {formatCurrency(summary.realizedPnlAud)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {closedTrades} closed
                      </Typography>
                    </TableCell>
                    <TableCell align="right" sx={{ borderColor: alpha(theme.palette.divider, 0.08) }}>
                      {formatPercent(getWinRate(summary))}
                    </TableCell>
                    <TableCell align="right" sx={{ borderColor: alpha(theme.palette.divider, 0.08) }}>
                      {signalCount}
                    </TableCell>
                    <TableCell sx={{ borderColor: alpha(theme.palette.divider, 0.08) }}>
                      <Typography variant="caption" sx={{ color: telemetry.edgeTone, fontFamily: '"Roboto Mono", monospace', fontWeight: 800 }}>
                        {telemetry.hasEdge ? telemetry.edgeLabel : telemetry.edgeGateLabel}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ borderColor: alpha(theme.palette.divider, 0.08) }}>
                      <Typography variant="caption" sx={{ color: telemetry.costTone, fontFamily: '"Roboto Mono", monospace', fontWeight: 800 }}>
                        {telemetry.hasCost ? telemetry.spreadLabel : telemetry.costGateLabel}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {telemetry.freshnessGateLabel}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ borderColor: alpha(theme.palette.divider, 0.08) }}>
                      <Typography variant="caption" sx={{ color: telemetry.regimeTone, fontWeight: 800 }}>
                        {telemetry.regimeLabel}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ borderColor: alpha(theme.palette.divider, 0.08) }}>
                      <Chip
                        size="small"
                        label={telemetry.broker.label}
                        color={telemetry.broker.color}
                        variant={telemetry.broker.feedsBroker ? 'filled' : 'outlined'}
                        sx={{ height: 20, fontSize: '0.62rem', fontWeight: 800 }}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Stack>
    </GlassCard>
  );
};

const InstructionList = ({ items = [], ordered = false }) => {
  const theme = useTheme();

  return (
    <Stack spacing={1.25}>
      {items.map((item, index) => (
        <Box key={item} display="flex" gap={1.25} alignItems="flex-start">
          <Box
            sx={{
              minWidth: 24,
              height: 24,
              borderRadius: '50%',
              bgcolor: alpha(theme.palette.primary.main, 0.12),
              color: 'primary.main',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.75rem',
              fontWeight: 800,
              mt: 0.15,
            }}
          >
            {ordered ? index + 1 : '•'}
          </Box>
          <Typography variant="body2" color="text.secondary">
            {item}
          </Typography>
        </Box>
      ))}
    </Stack>
  );
};

const CandidateStrategyGuide = ({ strategies = [] }) => {
  const theme = useTheme();

  if (strategies.length === 0) {
    return (
      <Alert severity="info">
        Candidate strategy metadata is still loading. Refresh the page if the catalog does not appear.
      </Alert>
    );
  }

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
        gap: 2,
      }}
    >
      {strategies.map((strategy) => (
        <GlassCard
          key={strategy.key}
          sx={{
            p: 2,
            background: `linear-gradient(160deg, ${alpha(theme.palette.secondary.main, 0.08)}, ${alpha(theme.palette.background.paper, 0.92)})`,
          }}
        >
          <Stack spacing={1.25}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              justifyContent="space-between"
              alignItems={{ xs: 'flex-start', sm: 'center' }}
              spacing={1}
            >
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                  {strategy.label}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontFamily: '"Roboto Mono", monospace' }}>
                  {strategy.key}
                </Typography>
              </Box>
              <Chip
                size="small"
                label={`Phase ${strategy.phaseIntroduced || '?'}`}
                color="secondary"
                variant="outlined"
              />
            </Stack>

            <Typography variant="body2" color="text.secondary">
              {strategy.description || 'Candidate strategy'}
            </Typography>

            {CANDIDATE_WATCH_NOTES[strategy.key] && (
              <Alert
                severity="info"
                sx={{
                  py: 0.5,
                  bgcolor: alpha(theme.palette.info.main, 0.08),
                  border: `1px solid ${alpha(theme.palette.info.main, 0.16)}`,
                }}
              >
                {CANDIDATE_WATCH_NOTES[strategy.key]}
              </Alert>
            )}

            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {(strategy.requiredData?.timeframes || []).map((timeframe) => (
                <Chip
                  key={`${strategy.key}-${timeframe}`}
                  size="small"
                  label={String(timeframe).toUpperCase()}
                  variant="outlined"
                />
              ))}
            </Stack>
          </Stack>
        </GlassCard>
      ))}
    </Box>
  );
};

const SignalFeed = ({ signals = [], run = null }) => (
  <Stack spacing={1.25}>
    {signals.length === 0 && (
      <Alert severity="info">No persisted runtime signals for this run yet.</Alert>
    )}
    {signals.map((signal, index) => {
      const telemetry = extractSignalTelemetry(signal, {
        config: run?.configSnapshot,
        runtimeMode: run?.mode,
        tradingEnabled: run?.mode === 'live' ? run?.configSnapshot?.enableTrading : false,
      });

      return (
        <GlassCard key={`${signal.timestamp}-${signal.symbol}-${index}`} sx={{ p: 1.5 }}>
          <Stack spacing={1}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                  {signal.symbol} {signal.signal}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {signal.reasonCode || signal.message || 'Runtime signal'}
                </Typography>
              </Box>
              <Stack direction="row" spacing={1} alignItems="center">
                <Chip
                  size="small"
                  label={signal.signalClass || 'signal'}
                  color={signal.signal === 'BUY' ? 'success' : signal.signal === 'SELL' ? 'error' : 'default'}
                  variant="outlined"
                />
                <Typography variant="caption" color="text.secondary">
                  {formatDateTime(signal.timestamp)}
                </Typography>
              </Stack>
            </Stack>

            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
              <Chip
                size="small"
                label={`Edge ${telemetry.edgeLabel}`}
                variant="outlined"
                sx={{ height: 20, fontSize: '0.62rem', color: telemetry.edgeTone, fontWeight: 800 }}
              />
              <Chip
                size="small"
                label={`Cost ${telemetry.spreadLabel}`}
                variant="outlined"
                sx={{ height: 20, fontSize: '0.62rem', color: telemetry.costTone, fontWeight: 800 }}
              />
              <Chip
                size="small"
                label={telemetry.regimeLabel}
                variant="outlined"
                sx={{ height: 20, fontSize: '0.62rem', color: telemetry.regimeTone, fontWeight: 800 }}
              />
              <Chip
                size="small"
                label={telemetry.broker.label}
                color={telemetry.broker.color}
                variant={telemetry.broker.feedsBroker ? 'filled' : 'outlined'}
                sx={{ height: 20, fontSize: '0.62rem', fontWeight: 800 }}
              />
            </Stack>
          </Stack>
        </GlassCard>
      );
    })}
  </Stack>
);

const ConfigSnapshot = ({ run }) => (
  <GlassCard sx={{ p: 2, height: '100%' }}>
    <Box mb={1.5}>
      <Typography variant="overline" sx={{ letterSpacing: 1.3, color: 'secondary.main', fontWeight: 800 }}>
        Config Snapshot
      </Typography>
      <Typography variant="h6" sx={{ fontWeight: 800 }}>
        {run?.metadata?.displayName || run?.strategy || 'Run Config'}
      </Typography>
    </Box>
    <Box
      component="pre"
      sx={{
        m: 0,
        p: 1.5,
        borderRadius: 2,
        bgcolor: 'rgba(15, 23, 42, 0.36)',
        color: 'text.primary',
        fontSize: '0.75rem',
        lineHeight: 1.5,
        fontFamily: '"Roboto Mono", monospace',
        overflow: 'auto',
        maxHeight: 340,
      }}
    >
      {JSON.stringify(run?.configSnapshot || {}, null, 2)}
    </Box>
  </GlassCard>
);

const RunCard = ({
  title,
  subtitle,
  run,
  summary,
  badges = [],
  controls = null,
  accent = 'primary.main',
  selected = false,
  onSelect = null,
}) => {
  const theme = useTheme();

  return (
    <GlassCard
      onClick={onSelect || undefined}
      sx={{
        p: 2,
        cursor: onSelect ? 'pointer' : 'default',
        border: selected
          ? `1px solid ${alpha(theme.palette.primary.main, 0.46)}`
          : `1px solid ${alpha(theme.palette.divider, 0.1)}`,
        boxShadow: selected ? `0 0 0 1px ${alpha(theme.palette.primary.main, 0.18)}` : 'none',
        background: `linear-gradient(160deg, ${alpha(theme.palette.background.paper, 0.72)}, ${alpha(theme.palette.background.default, 0.92)})`,
      }}
    >
      <Stack spacing={1.5}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          spacing={1}
        >
          <Box>
            <Typography variant="overline" sx={{ color: accent, letterSpacing: 1.4, fontWeight: 800 }}>
              {subtitle}
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.1 }}>
              {title}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              label={run ? run.status.replace(/_/g, ' ') : 'not started'}
              color={getRunStatusColor(run?.status)}
              variant="outlined"
            />
            <Chip size="small" label={`Run ${formatRunId(run?.runId)}`} variant="outlined" />
            {run?.selectionId && (
              <Chip size="small" label={`Sel ${formatRunId(run.selectionId)}`} variant="outlined" />
            )}
          </Stack>
        </Stack>

        {badges.length > 0 && (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {badges.map((badge) => (
              <Chip
                key={`${run?.runId || title}-${badge.label}`}
                size="small"
                label={badge.label}
                color={badge.color || 'default'}
                variant="outlined"
              />
            ))}
          </Stack>
        )}

        <Divider sx={{ borderColor: alpha(theme.palette.divider, 0.08) }} />

        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
          <SummaryMetric label="Equity" value={formatCurrency(summary?.totalValueAud)} />
          <SummaryMetric label="Realized" value={formatCurrency(summary?.realizedPnlAud)} />
          <SummaryMetric label="Unrealized" value={formatCurrency(summary?.unrealizedPnlAud)} />
          <SummaryMetric label="Trades" value={`${summary?.closedTradeCount || 0} closed`} />
          <SummaryMetric label="Open" value={`${summary?.openTradeCount || 0} live`} />
        </Stack>

        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
          <SummaryMetric label="Wins" value={summary?.winningTrades || 0} />
          <SummaryMetric label="Losses" value={summary?.losingTrades || 0} />
          <SummaryMetric label="Flat" value={summary?.flatTrades || 0} />
          <SummaryMetric label="Last Signal" value={summary?.lastSignal?.signal || 'Waiting'} />
          <SummaryMetric label="Last Update" value={formatDateTime(summary?.lastSignalAt || run?.startedAt)} />
        </Stack>

        <RunTelemetryStrip run={run} />

        {summary?.lastSignal && (
          <Alert
            severity="info"
            sx={{
              py: 0.5,
              bgcolor: alpha(theme.palette.info.main, 0.08),
              border: `1px solid ${alpha(theme.palette.info.main, 0.16)}`,
            }}
          >
            {summary.lastSignal.instrument} {summary.lastSignal.signal}
            {summary.lastSignal.reasonCode ? ` • ${summary.lastSignal.reasonCode}` : ''}
          </Alert>
        )}

        {controls}
      </Stack>
    </GlassCard>
  );
};

const BacktestLab = () => {
  const theme = useTheme();
  const [runtimeData, setRuntimeData] = useState({ runs: [], liveSelection: null });
  const [strategyCatalog, setStrategyCatalog] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [selectedRunDetail, setSelectedRunDetail] = useState({
    trades: [],
    signals: [],
    equity: null,
    loading: false,
    error: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionMessage, setActionMessage] = useState(null);
  const [submittingStrategy, setSubmittingStrategy] = useState(null);
  const [mutatingRunId, setMutatingRunId] = useState(null);
  const [promotingRunId, setPromotingRunId] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);

  const loadPaperComparison = useCallback(async (showSpinner = false) => {
    if (showSpinner) {
      setLoading(true);
    }

    try {
      setError(null);
      const [runsResponse, catalog] = await Promise.all([
        runtimeAPI.getRuns(),
        strategiesAPI.getCatalog(),
      ]);

      const nextRuns = Array.isArray(runsResponse?.runs) ? runsResponse.runs : [];
      const nextLiveSelection = runsResponse?.liveSelection || null;
      const nextShadowRunId =
        nextLiveSelection?.shadowRun?.runId ||
        nextRuns.find((run) => run.mode === 'paper_shadow' && run.status === 'active')?.runId ||
        '';
      const nextCandidateRunId =
        nextRuns.find((run) => run.mode === 'paper_candidate' && run.status === 'active')?.runId ||
        nextRuns.find((run) => run.mode === 'paper_candidate')?.runId ||
        '';

      setRuntimeData({
        runs: nextRuns,
        liveSelection: nextLiveSelection,
      });
      setStrategyCatalog(Array.isArray(catalog) ? catalog : []);
      setSelectedRunId((current) => {
        if (current && nextRuns.some((run) => run.runId === current)) {
          return current;
        }
        return nextShadowRunId || nextCandidateRunId;
      });
      setLastUpdate(Date.now());
    } catch (err) {
      setError(err.message);
    } finally {
      if (showSpinner) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadPaperComparison(true);

    const refresh = () => {
      loadPaperComparison(false);
    };

    PAPER_EVENT_NAMES.forEach((eventName) => socket.on(eventName, refresh));
    if (!socket.connected) {
      socket.connect();
    }
    const intervalId = window.setInterval(() => refresh(), PAPER_REFRESH_INTERVAL_MS);

    return () => {
      PAPER_EVENT_NAMES.forEach((eventName) => socket.off(eventName, refresh));
      window.clearInterval(intervalId);
    };
  }, [loadPaperComparison]);

  useEffect(() => {
    let cancelled = false;

    const loadRunDetail = async () => {
      if (!selectedRunId) {
        setSelectedRunDetail({
          trades: [],
          signals: [],
          equity: null,
          loading: false,
          error: null,
        });
        return;
      }

      setSelectedRunDetail((current) => ({
        ...current,
        loading: true,
        error: null,
      }));

      try {
        const [tradeResponse, signalResponse, equityResponse] = await Promise.all([
          runtimeAPI.getRunTrades(selectedRunId, { limit: 50 }),
          runtimeAPI.getRunSignals(selectedRunId, { limit: 20 }),
          runtimeAPI.getRunEquity(selectedRunId, { limit: 250 }),
        ]);

        if (cancelled) return;

        setSelectedRunDetail({
          trades: Array.isArray(tradeResponse?.trades) ? tradeResponse.trades : [],
          signals: Array.isArray(signalResponse?.signals) ? signalResponse.signals : [],
          equity: equityResponse || null,
          loading: false,
          error: null,
        });
      } catch (err) {
        if (!cancelled) {
          setSelectedRunDetail({
            trades: [],
            signals: [],
            equity: null,
            loading: false,
            error: err.message,
          });
        }
      }
    };

    loadRunDetail();

    return () => {
      cancelled = true;
    };
  }, [selectedRunId]);

  const liveSelection = runtimeData.liveSelection || null;
  const runs = runtimeData.runs || [];
  const candidateStrategies = useMemo(
    () => strategyCatalog.filter((strategy) => isCandidateStrategy(strategy)),
    [strategyCatalog]
  );
  const shadowRun = useMemo(() => {
    if (!liveSelection?.shadowRun?.runId) {
      return runs.find((run) => run.mode === 'paper_shadow' && run.status === 'active') || null;
    }

    return runs.find((run) => run.runId === liveSelection.shadowRun.runId) || liveSelection.shadowRun;
  }, [liveSelection, runs]);
  const candidateRuns = useMemo(
    () =>
      runs
        .filter((run) => run.mode === 'paper_candidate')
        .sort((left, right) => compareCandidateRuns(left, right, liveSelection)),
    [runs, liveSelection]
  );
  const activeCandidateRuns = useMemo(
    () => candidateRuns.filter((run) => run.status === 'active'),
    [candidateRuns]
  );
  const currentSelectionCandidateRuns = useMemo(
    () => activeCandidateRuns.filter((run) => isRunInCurrentSelection(run, liveSelection)),
    [activeCandidateRuns, liveSelection]
  );
  const legacyActiveCandidateRuns = useMemo(
    () => activeCandidateRuns.filter((run) => !isRunInCurrentSelection(run, liveSelection)),
    [activeCandidateRuns, liveSelection]
  );
  const selectedRun = useMemo(
    () => runs.find((run) => run.runId === selectedRunId) || shadowRun || null,
    [runs, selectedRunId, shadowRun]
  );

  const handleLaunchCandidate = async (strategy) => {
    try {
      setSubmittingStrategy(strategy.key);
      setError(null);
      setActionMessage(null);
      const response = await runtimeAPI.createRun({
        strategyKey: strategy.key,
        label: buildCandidateLabel(strategy, candidateRuns),
      });
      setSelectedRunId(response?.run?.runId || selectedRunId);
      await loadPaperComparison(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmittingStrategy(null);
    }
  };

  const handleResetCandidate = async (runId) => {
    try {
      setMutatingRunId(runId);
      setError(null);
      setActionMessage(null);
      await runtimeAPI.resetRun(runId);
      await loadPaperComparison(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setMutatingRunId(null);
    }
  };

  const handleResetShadowBaseline = async (run) => {
    if (!run?.runId) {
      return;
    }

    const confirmed = window.confirm(
      'Reset shadow baseline?\n\nThis clears the current shadow paper history and starts a fresh sample from the current market context. The live selection and live trades are not changed.'
    );

    if (!confirmed) {
      return;
    }

    try {
      setMutatingRunId(run.runId);
      setError(null);
      setActionMessage(null);
      const response = await runtimeAPI.resetRun(run.runId);
      setSelectedRunId(response?.run?.runId || run.runId);
      setActionMessage(response?.message || 'Shadow baseline reset');
      await loadPaperComparison(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setMutatingRunId(null);
    }
  };

  const handleResetAllPaper = async () => {
    const confirmed = window.confirm(
      'Reset ALL paper trading?\n\nThis clears shadow and candidate paper trades, signals, entry decisions, portfolio snapshots, and paper run summaries. Live trades and live selection are not changed.'
    );

    if (!confirmed) {
      return;
    }

    try {
      setMutatingRunId('__all_paper__');
      setError(null);
      setActionMessage(null);
      const response = await runtimeAPI.resetAllPaper();
      setSelectedRunId(response?.liveSelection?.shadowRun?.runId || selectedRunId);
      setActionMessage(response?.message || 'All paper trading state reset');
      await loadPaperComparison(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setMutatingRunId(null);
    }
  };

  const handleStopCandidate = async (runId) => {
    try {
      setMutatingRunId(runId);
      setError(null);
      setActionMessage(null);
      await runtimeAPI.stopRun(runId);
      await loadPaperComparison(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setMutatingRunId(null);
    }
  };

  const handlePromoteCandidate = async (run) => {
    const runLabel = run?.metadata?.displayName || getStrategyLabel(run?.strategy, strategyCatalog);
    const confirmed = window.confirm(
      `Promote ${runLabel} to live?\n\nThis will pause the live engine during the cutover, immediately liquidate any open live positions before switching, and then move the active live selection to this candidate's config snapshot.`
    );

    if (!confirmed) {
      return;
    }

    try {
      setPromotingRunId(run.runId);
      setError(null);
      setActionMessage(null);
      const response = await runtimeAPI.promoteRun(run.runId);
      const nextShadowRunId =
        response?.liveSelection?.shadowRun?.runId ||
        response?.liveSelection?.shadowRunId ||
        '';
      const restartWarning = response?.promotion?.engineRestartWarning;
      setSelectedRunId(nextShadowRunId || run.runId);
      setActionMessage(
        restartWarning
          ? `${response?.message || `${runLabel} promoted to live`}. The paired shadow run is now the live paper mirror. Engine restart warning: ${restartWarning}`
          : `${response?.message || `${runLabel} promoted to live`}. The paired shadow run is now the live paper mirror.`
      );
      await loadPaperComparison(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setPromotingRunId(null);
    }
  };

  if (loading && !liveSelection) {
    return (
      <Box minHeight="80vh" display="flex" alignItems="center" justifyContent="center">
        <LinearProgress sx={{ width: 320 }} />
      </Box>
    );
  }

  return (
    <Container
      maxWidth={false}
      sx={{
        py: 3,
        minHeight: 'calc(100vh - 64px)',
      }}
    >
      <Stack spacing={2.5}>
        <GlassCard
          sx={{
            p: 3,
            background: `radial-gradient(circle at top left, ${alpha(theme.palette.primary.main, 0.18)}, ${alpha(theme.palette.background.paper, 0.92)})`,
          }}
        >
          <Stack
            direction={{ xs: 'column', lg: 'row' }}
            justifyContent="space-between"
            alignItems={{ xs: 'flex-start', lg: 'center' }}
            spacing={2}
          >
            <Box>
              <Stack direction="row" spacing={1} alignItems="center" mb={1}>
                <CompareArrows sx={{ color: 'primary.main' }} />
                <Typography variant="overline" sx={{ letterSpacing: 1.6, color: 'primary.main', fontWeight: 800 }}>
                  PAPER COMPARISON
                </Typography>
              </Stack>
              <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: -1 }}>
                Shadow Baseline vs Candidate Runs
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 760, mt: 1 }}>
                Compare paper PnL, signal feed, cost gates, expected edge, regime, and config snapshot on the same run identity.
              </Typography>
            </Box>

            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Chip
                label={`Live ${getStrategyLabel(liveSelection?.strategy, strategyCatalog)}`}
                color="primary"
                variant="outlined"
              />
              <Chip
                label={`Active candidates ${activeCandidateRuns.length}`}
                color="secondary"
                variant="outlined"
              />
              <Chip
                label={`Current selection ${currentSelectionCandidateRuns.length}`}
                color="success"
                variant="outlined"
              />
              <Button variant="outlined" size="small" startIcon={<Refresh />} onClick={() => loadPaperComparison(true)}>
                Refresh
              </Button>
              <Button
                variant="outlined"
                color="error"
                size="small"
                startIcon={<RestartAlt />}
                onClick={handleResetAllPaper}
                disabled={mutatingRunId === '__all_paper__'}
              >
                {mutatingRunId === '__all_paper__' ? 'Resetting Paper...' : 'Reset All Paper'}
              </Button>
            </Stack>
          </Stack>

          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap sx={{ mt: 2 }}>
            <Chip label={`Selection ${formatRunId(liveSelection?.selectionId)}`} variant="outlined" />
            <Chip label={`Shadow ${shadowRun?.status || 'starting'}`} color={shadowRun ? 'success' : 'default'} variant="outlined" />
            <Chip label={`Focused ${formatRunId(selectedRun?.runId)}`} variant="outlined" />
            <Chip label={`Last sync ${lastUpdate ? new Date(lastUpdate).toLocaleTimeString() : '--:--:--'}`} variant="outlined" />
          </Stack>
        </GlassCard>

        {error && (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {actionMessage && (
          <Alert severity="success" onClose={() => setActionMessage(null)}>
            {actionMessage}
          </Alert>
        )}

        <GlassCard sx={{ p: 0, overflow: 'hidden' }}>
          <Accordion
            disableGutters
            defaultExpanded={false}
            elevation={0}
            sx={{
              bgcolor: 'transparent',
              boxShadow: 'none',
              '&::before': {
                display: 'none',
              },
            }}
          >
            <AccordionSummary
              expandIcon={<ExpandMore sx={{ color: 'primary.main' }} />}
              sx={{
                px: 2.5,
                py: 0.5,
                '& .MuiAccordionSummary-content': {
                  my: 2,
                },
              }}
            >
              <Box>
                <Typography
                  variant="overline"
                  sx={{ letterSpacing: 1.5, color: 'primary.main', fontWeight: 800 }}
                >
                  Operator Guide
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>
                  How to Use Paper Comparison
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  Collapsed by default. Expand for workflow steps, candidate notes, and promotion checks.
                </Typography>
              </Box>
            </AccordionSummary>

            <AccordionDetails sx={{ px: 2.5, pb: 2.5, pt: 0 }}>
              <Stack spacing={2}>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1fr) minmax(0, 1fr)' },
                    gap: 2,
                  }}
                >
                  <GlassCard sx={{ p: 2 }}>
                    <Stack spacing={1.5}>
                      <Typography
                        variant="overline"
                        sx={{ letterSpacing: 1.4, color: 'secondary.main', fontWeight: 800 }}
                      >
                        Workflow
                      </Typography>
                      <InstructionList items={PAPER_COMPARISON_STEPS} ordered />
                    </Stack>
                  </GlassCard>

                  <GlassCard sx={{ p: 2 }}>
                    <Stack spacing={1.5}>
                      <Typography
                        variant="overline"
                        sx={{ letterSpacing: 1.4, color: 'secondary.main', fontWeight: 800 }}
                      >
                        What to Watch
                      </Typography>
                      <InstructionList items={PERFORMANCE_WATCHLIST} />
                      <Divider sx={{ borderColor: alpha(theme.palette.divider, 0.08) }} />
                      <Typography
                        variant="overline"
                        sx={{ letterSpacing: 1.4, color: 'secondary.main', fontWeight: 800 }}
                      >
                        Promotion Checklist
                      </Typography>
                      <InstructionList items={PROMOTION_CHECKLIST} />
                    </Stack>
                  </GlassCard>
                </Box>

                <Box>
                  <Typography
                    variant="overline"
                    sx={{ letterSpacing: 1.4, color: 'secondary.main', fontWeight: 800 }}
                  >
                    Candidate Playbook
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1.5 }}>
                    Each candidate below is launched as its own isolated paper run. Use these summaries as a quick reminder of what each strategy is trying to prove before you compare it against the shadow baseline.
                  </Typography>
                  <CandidateStrategyGuide strategies={candidateStrategies} />
                </Box>
              </Stack>
            </AccordionDetails>
          </Accordion>
        </GlassCard>

        <GlassCard sx={{ p: 2.5 }}>
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} alignItems="center">
              <AutoGraph sx={{ color: 'secondary.main' }} />
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                Launch Candidate Runs
              </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              Re-launching the same strategy creates a separate candidate run with its own identity, telemetry, and config snapshot.
            </Typography>
            <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
              {candidateStrategies.map((strategy) => (
                <Button
                  key={strategy.key}
                  variant="contained"
                  onClick={() => handleLaunchCandidate(strategy)}
                  disabled={submittingStrategy !== null}
                  startIcon={<PlayArrow />}
                  sx={{
                    px: 2,
                    fontWeight: 700,
                    background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
                  }}
                >
                  {submittingStrategy === strategy.key ? 'Launching...' : `Launch ${strategy.label}`}
                </Button>
              ))}
            </Stack>
          </Stack>
        </GlassCard>

        <RunComparisonTable
          shadowRun={shadowRun}
          candidateRuns={candidateRuns}
          strategyCatalog={strategyCatalog}
        />

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', xl: 'minmax(340px, 0.95fr) minmax(0, 1.55fr)' },
            gap: 2,
          }}
        >
          <RunCard
            title={getStrategyLabel(shadowRun?.strategy || liveSelection?.strategy, strategyCatalog)}
            subtitle="Shadow Baseline"
            run={shadowRun}
            summary={shadowRun?.summary}
            accent="success.main"
            selected={selectedRunId === shadowRun?.runId}
            onSelect={() => shadowRun?.runId && setSelectedRunId(shadowRun.runId)}
            controls={
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                alignItems={{ xs: 'stretch', sm: 'center' }}
                spacing={1}
              >
                <Alert
                  severity="success"
                  sx={{
                    flex: 1,
                    py: 0.5,
                    bgcolor: alpha(theme.palette.success.main, 0.08),
                    border: `1px solid ${alpha(theme.palette.success.main, 0.18)}`,
                  }}
                >
                  This is the paper twin of the current live selection from its own start time. Manual reset starts a fresh sample without touching live trades.
                </Alert>
                <Button
                  variant="outlined"
                  size="small"
                  color="success"
                  startIcon={<RestartAlt />}
                  disabled={
                    !shadowRun?.runId ||
                    shadowRun.status !== 'active' ||
                    mutatingRunId !== null ||
                    promotingRunId !== null
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    handleResetShadowBaseline(shadowRun);
                  }}
                  sx={{ alignSelf: { xs: 'stretch', sm: 'center' }, whiteSpace: 'nowrap' }}
                >
                  {mutatingRunId === shadowRun?.runId ? 'Resetting...' : 'Reset Baseline'}
                </Button>
              </Stack>
            }
          />

          <GlassCard sx={{ p: 2 }}>
            <Stack spacing={2}>
              <Box>
                <Typography variant="overline" sx={{ letterSpacing: 1.5, color: 'secondary.main', fontWeight: 800 }}>
                  Candidate Grid
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>
                  Candidate Runs
                </Typography>
              </Box>

              {legacyActiveCandidateRuns.length > 0 && (
                <Alert severity="info">
                  {legacyActiveCandidateRuns.length} active candidate run{legacyActiveCandidateRuns.length === 1 ? '' : 's'} belong to older selections. They remain useful for historical comparison, but only the paired shadow run mirrors the current live strategy.
                </Alert>
              )}

              {activeCandidateRuns.length === 0 && (
                <Alert severity="info">
                  No candidate runs are active yet. Launch a strategy to compare it against the shadow baseline.
                </Alert>
              )}

              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                  gap: 2,
                }}
              >
                {candidateRuns.map((run) => (
                  (() => {
                    const runNotice = getCandidateRunNotice(run, liveSelection);
                    const runBadges = getCandidateRunBadges(run, liveSelection);

                    return (
                  <RunCard
                    key={run.runId}
                    title={run.metadata?.displayName || getStrategyLabel(run.strategy, strategyCatalog)}
                    subtitle={getStrategyLabel(run.strategy, strategyCatalog)}
                    run={run}
                    summary={run.summary}
                    badges={runBadges}
                    accent="secondary.main"
                    selected={selectedRunId === run.runId}
                    onSelect={() => setSelectedRunId(run.runId)}
                    controls={
                      <Stack spacing={1.25}>
                        {runNotice && (
                          <Alert
                            severity="info"
                            sx={{
                              py: 0.5,
                              bgcolor: alpha(theme.palette.info.main, 0.08),
                              border: `1px solid ${alpha(theme.palette.info.main, 0.16)}`,
                            }}
                          >
                            {runNotice}
                          </Alert>
                        )}
                        <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="center">
                          <Button variant="text" size="small" onClick={() => setSelectedRunId(run.runId)}>
                            Inspect
                          </Button>
                          <Stack direction="row" spacing={1}>
                            {isRunPromotable(run, strategyCatalog, liveSelection) && (
                              <Button
                                variant="contained"
                                size="small"
                                color="secondary"
                                startIcon={<Timeline />}
                                disabled={mutatingRunId !== null || promotingRunId !== null}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handlePromoteCandidate(run);
                                }}
                              >
                                {promotingRunId === run.runId ? 'Promoting...' : 'Promote to Live'}
                              </Button>
                            )}
                            {run.status === 'active' && (
                              <Button
                                variant="outlined"
                                size="small"
                                startIcon={<RestartAlt />}
                                disabled={mutatingRunId !== null || promotingRunId !== null}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleResetCandidate(run.runId);
                                }}
                              >
                                {mutatingRunId === run.runId ? 'Working...' : 'Reset'}
                              </Button>
                            )}
                            {run.status === 'active' && (
                              <Button
                                variant="outlined"
                                size="small"
                                color="error"
                                startIcon={<Stop />}
                                disabled={mutatingRunId !== null || promotingRunId !== null}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleStopCandidate(run.runId);
                                }}
                              >
                                {mutatingRunId === run.runId ? 'Working...' : 'Stop'}
                              </Button>
                            )}
                          </Stack>
                        </Stack>
                      </Stack>
                    }
                  />
                    );
                  })()
                ))}
              </Box>
            </Stack>
          </GlassCard>
        </Box>

        {selectedRun && (
          <GlassCard sx={{ p: 2.5 }}>
            <Stack spacing={2}>
              <Stack
                direction={{ xs: 'column', lg: 'row' }}
                justifyContent="space-between"
                alignItems={{ xs: 'flex-start', lg: 'center' }}
                spacing={1}
              >
                <Box>
                  <Typography variant="overline" sx={{ letterSpacing: 1.5, color: 'primary.main', fontWeight: 800 }}>
                    Run Detail
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 900 }}>
                    {selectedRun.metadata?.displayName || getStrategyLabel(selectedRun.strategy, strategyCatalog)}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip label={selectedRun.mode.replace(/_/g, ' ')} variant="outlined" />
                  <Chip label={`Status ${selectedRun.status.replace(/_/g, ' ')}`} color={getRunStatusColor(selectedRun.status)} variant="outlined" />
                  <Chip label={`Run ${formatRunId(selectedRun.runId)}`} variant="outlined" />
                  <Chip label={`Selection ${formatRunId(selectedRun.selectionId)}`} variant="outlined" />
                </Stack>
              </Stack>

              {selectedRunDetail.error && (
                <Alert severity="error">{selectedRunDetail.error}</Alert>
              )}

              {selectedRun?.mode === 'paper_candidate' && getCandidateRunNotice(selectedRun, liveSelection) && (
                <Alert severity="info">
                  {getCandidateRunNotice(selectedRun, liveSelection)}
                </Alert>
              )}

              {selectedRunDetail.loading && <LinearProgress />}

              <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
                <SummaryMetric label="Equity Source" value={selectedRunDetail.equity?.source || 'loading'} />
                <SummaryMetric label="Trades" value={selectedRun.summary?.totalTrades || 0} />
                <SummaryMetric label="Signals" value={selectedRunDetail.signals.length} />
                <SummaryMetric label="Started" value={formatDateTime(selectedRun.startedAt)} />
              </Stack>

              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1.3fr) minmax(360px, 0.9fr)' },
                  gap: 2,
                }}
              >
                <GlassCard sx={{ p: 2 }}>
                  <EquityChart
                    equityCurve={selectedRunDetail.equity?.equityCurve || []}
                    dailyPnL={selectedRunDetail.equity?.dailyPnL || []}
                  />
                </GlassCard>

                <ConfigSnapshot run={selectedRun} />
              </Box>

              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1.2fr) minmax(320px, 0.8fr)' },
                  gap: 2,
                }}
              >
                <GlassCard sx={{ p: 2 }}>
                  <Typography variant="overline" sx={{ letterSpacing: 1.4, color: 'secondary.main', fontWeight: 800 }}>
                    Recent Trades
                  </Typography>
                  <Box sx={{ mt: 1, height: 360 }}>
                    <RecentTrades trades={selectedRunDetail.trades} />
                  </Box>
                </GlassCard>

                <GlassCard sx={{ p: 2 }}>
                  <Stack direction="row" spacing={1} alignItems="center" mb={1.5}>
                    <Timeline sx={{ color: 'secondary.main' }} />
                    <Typography variant="overline" sx={{ letterSpacing: 1.4, color: 'secondary.main', fontWeight: 800 }}>
                      Recent Signals
                    </Typography>
                  </Stack>
                  <SignalFeed signals={selectedRunDetail.signals} run={selectedRun} />
                </GlassCard>
              </Box>
            </Stack>
          </GlassCard>
        )}
      </Stack>
    </Container>
  );
};

export default BacktestLab;
