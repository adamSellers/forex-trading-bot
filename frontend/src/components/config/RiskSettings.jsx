// frontend/src/components/config/RiskSettings.jsx
import React, { useState } from 'react';
import {
  Box, Typography, TextField, Slider, Switch, FormControl,
  InputLabel, Select, MenuItem, InputAdornment, Grid, Stack,
  Chip, Divider, Collapse, IconButton
} from '@mui/material';
import { Security, ExpandMore, ExpandLess } from '@mui/icons-material';
import { GlassCard, SectionHeader } from './ConfigShared';

const RiskSettings = ({ config, updateConfig }) => {
  const [showAdvancedRisk, setShowAdvancedRisk] = useState(false);

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

          <Grid item xs={12}>
            <Divider sx={{ my: 1 }} />
          </Grid>

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
            <Typography variant="caption" color="text.secondary" sx={{ mt: 3, display: 'block' }}>
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
                TAKE PROFIT TARGET (% OF ACCOUNT)
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
                Close position when profit reaches this % of account balance
              </Typography>
            </Grid>
            <Grid item xs={12} md={6}>
              <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                <Typography variant="caption" color="text.secondary" display="block">
                  EXAMPLE (on $100 account)
                </Typography>
                <Typography variant="body2" fontWeight="bold">
                  Target: ${(100 * (config.takeProfitPercent || 0.06)).toFixed(2)} profit per trade
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  With 2% risk ($2) = {((config.takeProfitPercent || 0.06) / 0.02).toFixed(1)}:1 reward-to-risk ratio
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
    </Stack>
  );
};

export default RiskSettings;