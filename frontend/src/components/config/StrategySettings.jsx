// frontend/src/components/config/StrategySettings.jsx
import React, { useState } from 'react';
import {
  Box, Typography, TextField, Slider, Switch, FormControl,
  InputLabel, Select, MenuItem, InputAdornment, Grid, Stack,
  Chip, Divider, Alert, Collapse, IconButton
} from '@mui/material';
import { Science, Tune, Speed, TrendingUp, ExpandMore, ExpandLess, TrendingUpOutlined, Timeline } from '@mui/icons-material';
import { GlassCard, SectionHeader, msToHours, hoursToMs } from './ConfigShared';

const StrategySettings = ({ config, updateConfig }) => {
  const [showAdvancedStrategy, setShowAdvancedStrategy] = useState(false);
  const hasConfigKey = (key) => Object.prototype.hasOwnProperty.call(config, key);

  return (
    <Stack spacing={3}>
      {/* Core Strategy Settings */}
      <GlassCard>
        <SectionHeader
          icon={<Science />}
          title="SuperTrend + ADX Strategy"
          subtitle="Core trend-following configuration"
        />
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth>
              <InputLabel>Timeframe</InputLabel>
              <Select
                value={config.timeframe}
                label="Timeframe"
                onChange={(e) => updateConfig('timeframe', e.target.value)}
              >
                <MenuItem value="5m">5 Minutes (Scalping)</MenuItem>
                <MenuItem value="15m">15 Minutes (Recommended)</MenuItem>
                <MenuItem value="1h">1 Hour (Swing)</MenuItem>
                <MenuItem value="4h">4 Hours (Position)</MenuItem>
              </Select>
            </FormControl>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              15M balances signal frequency with trend reliability
            </Typography>
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="Signal Cooldown"
              type="number"
              value={config.signalCooldown}
              onChange={(e) => updateConfig('signalCooldown', parseInt(e.target.value))}
              InputProps={{ endAdornment: <InputAdornment position="end">seconds</InputAdornment> }}
              helperText="Minimum time between signals for same pair"
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <Box display="flex" justifyContent="space-between" alignItems="center" height="100%" sx={{ p: 1, border: 1, borderColor: 'divider', borderRadius: 1 }}>
              <Box>
                <Typography fontWeight="bold">Enable Short Selling</Typography>
                <Typography variant="caption" color="text.secondary">
                  Allow the bot to open SELL positions
                </Typography>
              </Box>
              <Switch
                checked={config.enableShorting ?? true}
                onChange={(e) => updateConfig('enableShorting', e.target.checked)}
                color="warning"
              />
            </Box>
          </Grid>
        </Grid>
      </GlassCard>

      <GlassCard>
        <SectionHeader
          icon={<Timeline />}
          title="TimesFM Overlay"
          subtitle="Local Google time-series forecast assist running on Lathe"
        />
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <Box
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}
            >
              <Box>
                <Typography fontWeight="bold">Enable TimesFM</Typography>
                <Typography variant="caption" color="text.secondary">
                  Keep enabled for observe mode telemetry even when it is not influencing entries
                </Typography>
              </Box>
              <Switch
                checked={config.timesFmEnabled ?? true}
                onChange={(e) => updateConfig('timesFmEnabled', e.target.checked)}
                color="primary"
              />
            </Box>
          </Grid>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth disabled={!config.timesFmEnabled}>
              <InputLabel>TimesFM Mode</InputLabel>
              <Select
                value={config.timesFmMode || 'observe'}
                label="TimesFM Mode"
                onChange={(e) => updateConfig('timesFmMode', e.target.value)}
              >
                <MenuItem value="disabled">Disabled</MenuItem>
                <MenuItem value="observe">Observe Only (Recommended)</MenuItem>
                <MenuItem value="size">Volatility Sizing</MenuItem>
                <MenuItem value="veto">Veto + Sizing</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              disabled={!config.timesFmEnabled}
              label="Forecast Horizon"
              type="number"
              value={config.timesFmHorizonBars ?? 12}
              onChange={(e) => updateConfig('timesFmHorizonBars', parseInt(e.target.value, 10))}
              InputProps={{ endAdornment: <InputAdornment position="end">bars</InputAdornment> }}
              helperText="15m bars forecasted ahead"
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              disabled={!config.timesFmEnabled}
              label="Request Timeout"
              type="number"
              value={config.timesFmTimeoutMs ?? 5000}
              onChange={(e) => updateConfig('timesFmTimeoutMs', parseInt(e.target.value, 10))}
              InputProps={{ endAdornment: <InputAdornment position="end">ms</InputAdornment> }}
              helperText="Pi-side timeout when Lathe is slow or unavailable"
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              disabled={!config.timesFmEnabled}
              label="Dead Zone"
              type="number"
              value={config.timesFmDeadZoneBps ?? 3}
              onChange={(e) => updateConfig('timesFmDeadZoneBps', parseFloat(e.target.value))}
              InputProps={{ endAdornment: <InputAdornment position="end">bps</InputAdornment> }}
              helperText="Small forecasts inside this range become neutral"
            />
          </Grid>
          {hasConfigKey('timesFmStrategyMinReturnBps') && (
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                disabled={!config.timesFmEnabled}
                label="Min Expected Edge"
                type="number"
                value={config.timesFmStrategyMinReturnBps ?? 10}
                onChange={(e) => updateConfig('timesFmStrategyMinReturnBps', parseFloat(e.target.value))}
                InputProps={{ endAdornment: <InputAdornment position="end">bps</InputAdornment> }}
                helperText="Minimum absolute forecast return before a TimesFM entry is eligible"
              />
            </Grid>
          )}
          {hasConfigKey('timesFmStrategyHighConfidenceMinReturnBps') && (
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                disabled={!config.timesFmEnabled}
                label="High Confidence Edge"
                type="number"
                value={config.timesFmStrategyHighConfidenceMinReturnBps ?? 7.5}
                onChange={(e) =>
                  updateConfig('timesFmStrategyHighConfidenceMinReturnBps', parseFloat(e.target.value))
                }
                InputProps={{ endAdornment: <InputAdornment position="end">bps</InputAdornment> }}
                helperText="Lower edge floor when confidence clears the high-confidence gate"
              />
            </Grid>
          )}
          {hasConfigKey('timesFmStrategyBlockExtremeVolatility') && (
            <Grid item xs={12} md={4}>
              <Box
                display="flex"
                justifyContent="space-between"
                alignItems="center"
                sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1, height: '100%' }}
              >
                <Box>
                  <Typography fontWeight="bold">Block Extreme Regime</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Reject forecast entries during extreme volatility
                  </Typography>
                </Box>
                <Switch
                  checked={config.timesFmStrategyBlockExtremeVolatility ?? true}
                  onChange={(e) => updateConfig('timesFmStrategyBlockExtremeVolatility', e.target.checked)}
                  disabled={!config.timesFmEnabled}
                  color="warning"
                />
              </Box>
            </Grid>
          )}
          <Grid item xs={12}>
            <Typography gutterBottom variant="subtitle2" color="text.secondary">
              VETO CONFIDENCE
            </Typography>
            <Box px={2} display="flex" alignItems="center" gap={2} sx={{ opacity: config.timesFmEnabled ? 1 : 0.5 }}>
              <Slider
                value={config.timesFmVetoConfidence ?? 0.75}
                min={0.5}
                max={0.95}
                step={0.05}
                disabled={!config.timesFmEnabled}
                onChange={(_, v) => updateConfig('timesFmVetoConfidence', v)}
                sx={{ flexGrow: 1 }}
                marks={[
                  { value: 0.5, label: '0.50' },
                  { value: 0.75, label: '0.75' },
                  { value: 0.95, label: '0.95' },
                ]}
              />
              <Chip label={(config.timesFmVetoConfidence ?? 0.75).toFixed(2)} size="small" />
            </Box>
            <Alert severity="info" sx={{ mt: 2 }}>
              <Typography variant="caption">
                Start in <strong>observe</strong> mode. Move to <strong>size</strong> or <strong>veto</strong> only after the logged forecast data proves useful.
              </Typography>
            </Alert>
          </Grid>
        </Grid>
      </GlassCard>

      {/* SuperTrend Parameters */}
      <GlassCard>
        <SectionHeader
          icon={<Tune />}
          title="SuperTrend Parameters"
          subtitle="ATR-based trend detection"
        />
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <Typography gutterBottom variant="subtitle2" color="text.secondary">ATR PERIOD</Typography>
            <Stack direction="row" spacing={2} alignItems="center">
              <Slider
                value={config.supertrendPeriod || 10}
                min={5} max={20}
                onChange={(_, v) => updateConfig('supertrendPeriod', v)}
                sx={{ flexGrow: 1 }}
              />
              <Chip label={config.supertrendPeriod || 10} size="small" />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Higher = smoother but slower signals (10 is standard)
            </Typography>
          </Grid>
          <Grid item xs={12} md={6}>
            <Typography gutterBottom variant="subtitle2" color="text.secondary">MULTIPLIER</Typography>
            <Stack direction="row" spacing={2} alignItems="center">
              <Slider
                value={config.supertrendMultiplier || 3.0}
                min={1.5} max={5.0} step={0.1}
                onChange={(_, v) => updateConfig('supertrendMultiplier', v)}
                sx={{ flexGrow: 1 }}
              />
              <Chip label={(config.supertrendMultiplier || 3.0).toFixed(1)} size="small" />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Higher = wider bands, fewer whipsaws (3.0 is standard)
            </Typography>
          </Grid>
        </Grid>
      </GlassCard>

      {/* Entry Filters */}
      <GlassCard>
        <SectionHeader
          icon={<Speed />}
          title="Entry Filters"
          subtitle="Trend strength requirements"
        />
        <Box mb={4}>
          <Box display="flex" justifyContent="space-between" mb={1}>
            <Box>
              <Typography fontWeight="bold">Minimum ADX Strength</Typography>
              <Typography variant="caption" color="text.secondary">
                Only enter when trend is strong enough
              </Typography>
            </Box>
            <Switch
              size="small"
              checked={config.enableAdxFilter}
              onChange={(e) => updateConfig('enableAdxFilter', e.target.checked)}
            />
          </Box>
          <Box px={2} display="flex" alignItems="center" gap={2} sx={{ opacity: config.enableAdxFilter ? 1 : 0.5 }}>
            <Slider
              value={config.minAdx}
              min={15} max={40}
              onChange={(_, v) => updateConfig('minAdx', v)}
              disabled={!config.enableAdxFilter}
              sx={{ flexGrow: 1 }}
              marks={[
                { value: 20, label: '20' },
                { value: 25, label: '25' },
                { value: 30, label: '30' },
              ]}
            />
            <Chip
              label={config.minAdx}
              color={config.minAdx < 20 ? 'warning' : config.minAdx > 30 ? 'error' : 'success'}
              size="small"
            />
          </Box>
          <Alert severity="info" sx={{ mt: 2 }}>
            <Typography variant="caption">
              <strong>Forex Tip:</strong> ADX 22 is a practical baseline for major pairs on this strategy.
            </Typography>
          </Alert>

          {/* ADX Slope Filter - nested under ADX filter */}
          <Box sx={{ mt: 3, ml: 2, pl: 2, borderLeft: 2, borderColor: 'divider', opacity: config.enableAdxFilter ? 1 : 0.5 }}>
            <Box display="flex" justifyContent="space-between" mb={1}>
              <Box>
                <Typography fontWeight="bold" variant="body2">
                  <TrendingUpOutlined sx={{ fontSize: 16, mr: 0.5, verticalAlign: 'text-bottom' }} />
                  Require Rising ADX
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Only enter when ADX is increasing vs N bars ago
                </Typography>
              </Box>
              <Switch
                size="small"
                checked={config.adxSlopeFilter ?? true}
                onChange={(e) => updateConfig('adxSlopeFilter', e.target.checked)}
                disabled={!config.enableAdxFilter}
              />
            </Box>
            <Box px={2} display="flex" alignItems="center" gap={2} sx={{ opacity: config.adxSlopeFilter && config.enableAdxFilter ? 1 : 0.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ minWidth: 60 }}>Lookback:</Typography>
              <Slider
                value={config.adxSlopeLookback ?? 3}
                min={2} max={10}
                onChange={(_, v) => updateConfig('adxSlopeLookback', v)}
                disabled={!config.adxSlopeFilter || !config.enableAdxFilter}
                sx={{ flexGrow: 1 }}
                marks={[
                  { value: 2, label: '2' },
                  { value: 5, label: '5' },
                  { value: 10, label: '10' },
                ]}
              />
              <Chip
                label={`${config.adxSlopeLookback ?? 3} bars`}
                size="small"
                variant="outlined"
              />
            </Box>
            <Alert severity="warning" sx={{ mt: 1 }} icon={false}>
              <Typography variant="caption">
                Catches trends early - when ADX is rising, not mature/plateauing.
              </Typography>
            </Alert>
          </Box>
        </Box>
        <Divider sx={{ my: 3 }} />
        <Box>
          <Box display="flex" justifyContent="space-between" mb={2}>
            <Box>
              <Typography fontWeight="bold">RSI Overbought Filter</Typography>
              <Typography variant="caption" color="text.secondary">
                Block entries when momentum is exhausted
              </Typography>
            </Box>
            <Switch
              size="small"
              checked={config.enableRsiFilter}
              onChange={(e) => updateConfig('enableRsiFilter', e.target.checked)}
            />
          </Box>
          <TextField
            fullWidth
            label="RSI Overbought Threshold"
            type="number"
            value={config.rsiOverbought}
            onChange={(e) => updateConfig('rsiOverbought', parseFloat(e.target.value))}
            size="small"
            disabled={!config.enableRsiFilter}
            helperText="Block BUY signals when RSI exceeds this value"
          />
          <TextField
            fullWidth
            sx={{ mt: 2 }}
            label="Fresh Long RSI Ceiling"
            type="number"
            value={config.freshLongRsiCeiling ?? 68}
            onChange={(e) => updateConfig('freshLongRsiCeiling', parseFloat(e.target.value))}
            size="small"
            disabled={!config.enableRsiFilter}
            helperText="Applies only to fresh long flips; HTF confirmations can still use the broader ceiling"
          />
        </Box>
      </GlassCard>

      {/* Continuation Entry Settings */}
      <GlassCard>
        <Box
          display="flex"
          justifyContent="space-between"
          alignItems="center"
          onClick={() => setShowAdvancedStrategy(!showAdvancedStrategy)}
          sx={{ cursor: 'pointer' }}
        >
          <SectionHeader
            icon={<TrendingUp />}
            title="Continuation Entry"
            subtitle="Catch missed entries when RSI cools down"
          />
          <IconButton size="small">
            {showAdvancedStrategy ? <ExpandLess /> : <ExpandMore />}
          </IconButton>
        </Box>

        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
          <Box>
            <Typography fontWeight="bold">Enable Continuation Entries</Typography>
            <Typography variant="caption" color="text.secondary">
              If RSI blocked initial flip, wait for cooldown
            </Typography>
          </Box>
          <Switch
            checked={config.enableContinuationEntry ?? true}
            onChange={(e) => updateConfig('enableContinuationEntry', e.target.checked)}
            color="primary"
          />
        </Box>

        <Collapse in={showAdvancedStrategy}>
          <Box sx={{ opacity: config.enableContinuationEntry ? 1 : 0.5, pointerEvents: config.enableContinuationEntry ? 'auto' : 'none' }}>
            <Divider sx={{ my: 2 }} />
            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Continuation RSI Threshold"
                  type="number"
                  value={config.continuationRsiThreshold ?? 70}
                  onChange={(e) => updateConfig('continuationRsiThreshold', parseFloat(e.target.value))}
                  size="small"
                  helperText={`RSI must drop below this (lower than ${config.rsiOverbought})`}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="caption" color="text.secondary" gutterBottom display="block">
                  Continuation Window
                </Typography>
                <Stack direction="row" spacing={2} alignItems="center">
                  <Slider
                    value={msToHours(config.continuationWindowMs ?? (4 * 60 * 60 * 1000))}
                    min={1} max={12} step={0.5}
                    onChange={(_, v) => updateConfig('continuationWindowMs', hoursToMs(v))}
                    sx={{ flexGrow: 1 }}
                  />
                  <Chip
                    label={`${msToHours(config.continuationWindowMs ?? (4 * 60 * 60 * 1000))}h`}
                    size="small"
                    color="primary"
                    variant="outlined"
                  />
                </Stack>
              </Grid>
              <Grid item xs={12}>
                <Typography variant="caption" color="text.secondary" gutterBottom display="block">
                  Max Price Deviation from Flip
                </Typography>
                <Stack direction="row" spacing={2} alignItems="center">
                  <Slider
                    value={(config.continuationMaxPriceDeviation ?? 0.005) * 100}
                    min={0.5} max={5} step={0.5}
                    onChange={(_, v) => updateConfig('continuationMaxPriceDeviation', v / 100)}
                    sx={{ flexGrow: 1 }}
                  />
                  <Chip
                    label={`${((config.continuationMaxPriceDeviation ?? 0.005) * 100).toFixed(1)}%`}
                    size="small"
                    color={config.continuationMaxPriceDeviation > 0.03 ? "warning" : "primary"}
                    variant="outlined"
                  />
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  Cancel if price moves too far above the flip price (0.5% is a tighter forex baseline)
                </Typography>
              </Grid>
            </Grid>
          </Box>
        </Collapse>
      </GlassCard>
    </Stack>
  );
};

export default StrategySettings;
