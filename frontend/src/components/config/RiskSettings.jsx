// frontend/src/components/config/RiskSettings.jsx
import React, { useState } from 'react';
import {
  Box, Typography, TextField, Slider, Switch, FormControl,
  InputLabel, Select, MenuItem, InputAdornment, Grid, Stack,
  Chip, Divider, Collapse, IconButton
} from '@mui/material';
import { Security, ExpandMore, ExpandLess } from '@mui/icons-material';
import { GlassCard, SectionHeader } from './ConfigShared';
import { getFreshFlipToggleKey } from '../analytics/signalTelemetry';

const RiskSettings = ({ config, updateConfig }) => {
  const [showAdvancedRisk, setShowAdvancedRisk] = useState(false);
  const hasConfigKey = (key) => Object.prototype.hasOwnProperty.call(config, key);
  const freshFlipToggleKey = getFreshFlipToggleKey(config);
  const freshFlipToggleIsDisable =
    freshFlipToggleKey && freshFlipToggleKey.toLowerCase().startsWith('disable');
  const freshFlipEnabled = freshFlipToggleKey
    ? freshFlipToggleIsDisable
      ? !Boolean(config[freshFlipToggleKey])
      : Boolean(config[freshFlipToggleKey])
    : null;

  return (
    <Stack spacing={3}>
      {/* Position Sizing */}
      <GlassCard>
        <SectionHeader 
          icon={<Security />} 
          title="Position Sizing" 
          subtitle="Risk-based or fixed units" 
        />
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth>
              <InputLabel>Position Size Method</InputLabel>
              <Select 
                value={config.positionSizeMethod || 'RISK'} 
                label="Position Size Method" 
                onChange={(e) => updateConfig('positionSizeMethod', e.target.value)}
              >
                <MenuItem value="RISK">Risk-Based (Recommended)</MenuItem>
                <MenuItem value="FIXED">Fixed Units</MenuItem>
              </Select>
            </FormControl>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Risk-based calculates position size from stop loss distance
            </Typography>
          </Grid>
          
          {config.positionSizeMethod === 'RISK' ? (
            <Grid item xs={12} md={6}>
              <Typography gutterBottom variant="subtitle2" color="text.secondary">RISK PER TRADE</Typography>
              <Stack direction="row" spacing={2} alignItems="center">
                <Slider 
                  value={(config.riskPerTrade || 0.02) * 100} 
                  min={0.5} max={5} step={0.5}
                  onChange={(_, v) => updateConfig('riskPerTrade', v / 100)} 
                  sx={{ flexGrow: 1 }} 
                />
                <Chip 
                  label={`${((config.riskPerTrade || 0.02) * 100).toFixed(1)}%`} 
                  color={config.riskPerTrade > 0.03 ? "error" : config.riskPerTrade > 0.02 ? "warning" : "success"} 
                />
              </Stack>
              <Typography variant="caption" color="text.secondary">
                Professional traders typically risk 1-2% per trade
              </Typography>
            </Grid>
          ) : (
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Fixed Position Size"
                type="number"
                value={config.fixedPositionUnits || 1000}
                onChange={(e) => updateConfig('fixedPositionUnits', parseInt(e.target.value))}
                InputProps={{ endAdornment: <InputAdornment position="end">units</InputAdornment> }}
                helperText="1,000 = micro lot, 10,000 = mini lot, 100,000 = standard lot"
              />
            </Grid>
          )}

          {config.positionSizeMethod === 'RISK' && (
            <Grid item xs={12} md={6}>
              <Typography gutterBottom variant="subtitle2" color="text.secondary">FRESH FLIP RISK MULTIPLIER</Typography>
              <Stack direction="row" spacing={2} alignItems="center">
                <Slider
                  value={config.freshFlipRiskMultiplier ?? 0.5}
                  min={0.25} max={1.0} step={0.05}
                  onChange={(_, v) => updateConfig('freshFlipRiskMultiplier', v)}
                  sx={{ flexGrow: 1 }}
                />
                <Chip
                  label={`${(config.freshFlipRiskMultiplier ?? 0.5).toFixed(2)}x`}
                  color={(config.freshFlipRiskMultiplier ?? 0.5) < 0.75 ? 'warning' : 'success'}
                />
              </Stack>
              <Typography variant="caption" color="text.secondary">
                Down-weights aggressive fresh flips while leaving HTF confirmations and pullbacks at full risk
              </Typography>
            </Grid>
          )}

          {freshFlipToggleKey && (
            <Grid item xs={12} md={6}>
              <Box
                display="flex"
                justifyContent="space-between"
                alignItems="center"
                height="100%"
                sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}
              >
                <Box>
                  <Typography fontWeight="bold">Fresh Flip Entries</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Backend key: {freshFlipToggleKey}
                  </Typography>
                </Box>
                <Switch
                  checked={freshFlipEnabled}
                  onChange={(e) =>
                    updateConfig(
                      freshFlipToggleKey,
                      freshFlipToggleIsDisable ? !e.target.checked : e.target.checked
                    )
                  }
                  color="warning"
                />
              </Box>
            </Grid>
          )}

          <Grid item xs={12}>
            <Divider sx={{ my: 1 }} />
          </Grid>

          {(hasConfigKey('maxSpreadPips') || hasConfigKey('maxPriceAgeMs')) && (
            <Grid item xs={12}>
              <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                <Stack
                  direction={{ xs: 'column', md: 'row' }}
                  spacing={3}
                  alignItems={{ xs: 'stretch', md: 'center' }}
                >
                  <Box minWidth={190}>
                    <Typography fontWeight="bold">Execution Cost Gate</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Broker-facing entries are blocked when live cost or quote freshness breaches these limits.
                    </Typography>
                  </Box>

                  {hasConfigKey('maxSpreadPips') && (
                    <Box flex={1} minWidth={220}>
                      <Typography gutterBottom variant="subtitle2" color="text.secondary">
                        MAX SPREAD
                      </Typography>
                      <Stack direction="row" spacing={2} alignItems="center">
                        <Slider
                          value={config.maxSpreadPips ?? 1.2}
                          min={0.4}
                          max={4}
                          step={0.1}
                          onChange={(_, v) => updateConfig('maxSpreadPips', v)}
                          sx={{ flexGrow: 1 }}
                        />
                        <Chip
                          label={`${(config.maxSpreadPips ?? 1.2).toFixed(1)} pips`}
                          color={(config.maxSpreadPips ?? 1.2) > 2 ? 'warning' : 'success'}
                          size="small"
                        />
                      </Stack>
                    </Box>
                  )}

                  {hasConfigKey('maxPriceAgeMs') && (
                    <Box minWidth={190}>
                      <TextField
                        fullWidth
                        label="Max Price Age"
                        type="number"
                        value={config.maxPriceAgeMs ?? 15000}
                        onChange={(e) => updateConfig('maxPriceAgeMs', parseInt(e.target.value, 10))}
                        InputProps={{ endAdornment: <InputAdornment position="end">ms</InputAdornment> }}
                        size="small"
                      />
                    </Box>
                  )}
                </Stack>
              </Box>
            </Grid>
          )}
          
          <Grid item xs={12} md={6}>
            <Typography gutterBottom variant="subtitle2" color="text.secondary">LEVERAGE</Typography>
            <Stack direction="row" spacing={2} alignItems="center">
              <Slider 
                value={config.leverage || 10} 
                min={1} max={30}
                onChange={(_, v) => updateConfig('leverage', v)} 
                sx={{ flexGrow: 1 }}
                marks={[
                  { value: 1, label: '1:1' },
                  { value: 10, label: '10:1' },
                  { value: 20, label: '20:1' },
                  { value: 30, label: '30:1' },
                ]}
              />
              <Chip 
                label={`${config.leverage || 10}:1`} 
                color={config.leverage > 20 ? "error" : config.leverage > 10 ? "warning" : "success"} 
              />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              ASIC limit is 30:1 for major pairs. Lower leverage = lower risk.
            </Typography>
          </Grid>
          
          <Grid item xs={12} md={6}>
            <Typography gutterBottom variant="subtitle2" color="text.secondary">MAX PORTFOLIO EXPOSURE</Typography>
            <Stack direction="row" spacing={2} alignItems="center">
              <Slider 
                value={(config.maxPortfolioExposure ?? 0.50) * 100} 
                min={20} max={100} step={10}
                onChange={(_, v) => updateConfig('maxPortfolioExposure', v / 100)} 
                sx={{ flexGrow: 1 }} 
              />
              <Chip 
                label={`${((config.maxPortfolioExposure ?? 0.50) * 100).toFixed(0)}%`} 
                color={config.maxPortfolioExposure > 0.7 ? "warning" : "success"} 
              />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Maximum % of capital in open positions at once
            </Typography>
          </Grid>
        </Grid>
      </GlassCard>

      {/* Stop Loss */}
      <GlassCard>
        <SectionHeader 
          icon={<Security />} 
          title="Stop Loss" 
          subtitle="Risk control per trade" 
        />
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth>
              <InputLabel>Stop Loss Type</InputLabel>
              <Select 
                value={config.stopLossType || 'ATR'} 
                label="Stop Loss Type" 
                onChange={(e) => updateConfig('stopLossType', e.target.value)}
              >
                <MenuItem value="FIXED">Fixed Pips</MenuItem>
                <MenuItem value="ATR">ATR Dynamic (Recommended)</MenuItem>
              </Select>
            </FormControl>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              ATR adapts to market volatility automatically
            </Typography>
          </Grid>
          
          {config.stopLossType === 'FIXED' ? (
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Stop Loss Distance"
                type="number"
                value={config.stopLossPips || 30}
                onChange={(e) => updateConfig('stopLossPips', parseInt(e.target.value))}
                InputProps={{ endAdornment: <InputAdornment position="end">pips</InputAdornment> }}
                helperText="Typical range: 20-50 pips for majors"
              />
            </Grid>
          ) : (
            <Grid item xs={12} md={6}>
              <Typography gutterBottom variant="subtitle2" color="text.secondary">ATR MULTIPLIER</Typography>
              <Stack direction="row" spacing={2} alignItems="center">
                <Slider
                  value={config.stopLossAtrMultiplier || 2.0}
                  min={1.0} max={4.0} step={0.1}
                  onChange={(_, v) => updateConfig('stopLossAtrMultiplier', v)}
                  sx={{ flexGrow: 1 }}
                />
                <Chip label={`${(config.stopLossAtrMultiplier || 2.0).toFixed(1)}x ATR`} size="small" />
              </Stack>
              <Typography variant="caption" color="text.secondary">
                Stop = Entry ± (ATR × Multiplier). 2.0x recommended for forex.
              </Typography>
            </Grid>
          )}

          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="Minimum Stop Distance"
              type="number"
              value={config.minStopLossPips || 12}
              onChange={(e) => updateConfig('minStopLossPips', parseInt(e.target.value))}
              InputProps={{ endAdornment: <InputAdornment position="end">pips</InputAdornment> }}
              helperText="Floor to prevent tight stops in low volatility"
            />
          </Grid>
        </Grid>
      </GlassCard>

      {/* Take Profit */}
      <GlassCard>
        <Box
          display="flex"
          justifyContent="space-between"
          alignItems="center"
        >
          <Box display="flex" alignItems="center" gap={2}>
            <SectionHeader
              icon={<Security />}
              title="Take Profit"
              subtitle="Lock in gains automatically"
            />
          </Box>
          <Box display="flex" alignItems="center" gap={1}>
            <Chip
              label={config.enableTakeProfit ? 'ENABLED' : 'DISABLED'}
              size="small"
              color={config.enableTakeProfit ? 'success' : 'default'}
            />
            <Switch
              checked={config.enableTakeProfit || false}
              onChange={(e) => updateConfig('enableTakeProfit', e.target.checked)}
            />
          </Box>
        </Box>

        <Collapse in={config.enableTakeProfit}>
          <Grid container spacing={3} sx={{ mt: 1 }}>
            <Grid item xs={12} md={6}>
              <Typography gutterBottom variant="subtitle2" color="text.secondary">
                TAKE PROFIT TARGET (% OF MARGIN)
              </Typography>
              <Stack direction="row" spacing={2} alignItems="center">
                <Slider
                  value={(config.takeProfitPercent || 0.06) * 100}
                  min={2} max={15} step={1}
                  onChange={(_, v) => updateConfig('takeProfitPercent', v / 100)}
                  sx={{ flexGrow: 1 }}
                />
                <Chip
                  label={`${((config.takeProfitPercent || 0.06) * 100).toFixed(0)}%`}
                  color="success"
                  sx={{ minWidth: 60 }}
                />
              </Stack>
              <Typography variant="caption" color="text.secondary">
                Close position when profit reaches this % of the margin used for the trade
              </Typography>
            </Grid>
            <Grid item xs={12} md={6}>
              <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                <Typography variant="caption" color="text.secondary" display="block">
                  EXAMPLE (with $46 margin)
                </Typography>
                <Typography variant="body2" fontWeight="bold">
                  Target: ${(46 * (config.takeProfitPercent || 0.06)).toFixed(2)} profit (~35 pips)
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  TP scales with position size (larger positions = larger margin = larger target)
                </Typography>
              </Box>
            </Grid>
          </Grid>
        </Collapse>
      </GlassCard>

      {/* Trailing Stop */}
      <GlassCard>
        <Box 
          display="flex" 
          justifyContent="space-between" 
          alignItems="center"
          onClick={() => setShowAdvancedRisk(!showAdvancedRisk)}
          sx={{ cursor: 'pointer' }}
        >
          <Box display="flex" alignItems="center" gap={2}>
            <Typography fontWeight="bold">Trailing Stop-Loss</Typography>
            <Chip 
              label={config.enableTrailingStops ? 'ENABLED' : 'DISABLED'} 
              size="small" 
              color={config.enableTrailingStops ? 'success' : 'default'}
            />
          </Box>
          <Box display="flex" alignItems="center" gap={1}>
            <Switch 
              checked={config.enableTrailingStops || false} 
              onChange={(e) => { e.stopPropagation(); updateConfig('enableTrailingStops', e.target.checked); }} 
            />
            <IconButton size="small">
              {showAdvancedRisk ? <ExpandLess /> : <ExpandMore />}
            </IconButton>
          </Box>
        </Box>
        <Typography variant="caption" color="text.secondary">
          Lock in profits by moving stop loss as price moves in your favor
        </Typography>
        
        <Collapse in={showAdvancedRisk && config.enableTrailingStops}>
          <Divider sx={{ my: 2 }} />
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <TextField 
                fullWidth 
                label="Trailing Distance" 
                type="number" 
                value={config.trailingStopPips || 25} 
                onChange={(e) => updateConfig('trailingStopPips', parseInt(e.target.value))} 
                InputProps={{ endAdornment: <InputAdornment position="end">pips</InputAdornment> }}
                helperText="How far behind price the stop trails"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField 
                fullWidth 
                label="Activation Threshold" 
                type="number" 
                value={config.trailingStopActivationPips || 20} 
                onChange={(e) => updateConfig('trailingStopActivationPips', parseInt(e.target.value))} 
                InputProps={{ endAdornment: <InputAdornment position="end">pips profit</InputAdornment> }}
                helperText="Only start trailing after this much profit"
              />
            </Grid>
          </Grid>
        </Collapse>
      </GlassCard>

      {/* Breakeven Protection */}
      <GlassCard>
        <Box
          display="flex"
          justifyContent="space-between"
          alignItems="center"
        >
          <Box display="flex" alignItems="center" gap={2}>
            <Typography fontWeight="bold">Breakeven Protection</Typography>
            <Chip
              label={config.enableBreakeven ? 'ENABLED' : 'DISABLED'}
              size="small"
              color={config.enableBreakeven ? 'success' : 'default'}
            />
          </Box>
          <Switch
            checked={config.enableBreakeven || false}
            onChange={(e) => updateConfig('enableBreakeven', e.target.checked)}
          />
        </Box>
        <Typography variant="caption" color="text.secondary">
          Move stop loss to entry once profit reaches a minimum pip threshold.
        </Typography>

        <Collapse in={config.enableBreakeven}>
          <Divider sx={{ my: 2 }} />
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Breakeven Trigger"
                type="number"
                value={config.breakevenTriggerPips || 12}
                onChange={(e) => updateConfig('breakevenTriggerPips', parseInt(e.target.value, 10))}
                InputProps={{ endAdornment: <InputAdornment position="end">pips profit</InputAdornment> }}
                helperText="When unrealized profit reaches this value, SL moves to entry price"
              />
            </Grid>
          </Grid>
        </Collapse>
      </GlassCard>
    </Stack>
  );
};

export default RiskSettings;
