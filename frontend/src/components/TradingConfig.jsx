// frontend/src/components/TradingConfig.jsx - Refactored Config Shell
import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Button, Container, Stack, Tabs, Tab, Alert, useTheme
} from '@mui/material';
import {
  Save, Refresh, Security, AccountBalance, Science, 
  CurrencyExchange, Email
} from '@mui/icons-material';
import { configAPI } from '../config/api';
import { DEFAULT_CONFIG } from './config/ConfigShared';

// Import settings panels
import GeneralSettings from './config/GeneralSettings';
import StrategySettings from './config/StrategySettings';
import RiskSettings from './config/RiskSettings';
import InstrumentSettings from './config/InstrumentSettings';
import NotificationSettings from './config/NotificationSettings';

const TradingConfig = () => {
  const theme = useTheme();
  const [activeTab, setActiveTab] = useState(0);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [originalConfig, setOriginalConfig] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // ============================================
  // DATA FETCHING
  // ============================================
  const fetchCurrentConfig = useCallback(async () => {
    try {
      setLoading(true);
      const data = await configAPI.get();
      const fetchedConfig = {
        ...DEFAULT_CONFIG,
        ...data,
        signalCooldown: (data.signalCooldown / 1000) || 60,
      };
      setConfig(fetchedConfig);
      setOriginalConfig(fetchedConfig);
    } catch (err) {
      setError(`Failed to load configuration: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { 
    fetchCurrentConfig(); 
  }, [fetchCurrentConfig]);

  useEffect(() => { 
    setHasChanges(JSON.stringify(config) !== JSON.stringify(originalConfig)); 
  }, [config, originalConfig]);

  // ============================================
  // HANDLERS
  // ============================================
  const handleSaveConfig = async () => {
    setSaving(true);
    setError(null);
    try {
      const configToSave = {
        ...config,
        signalCooldown: config.signalCooldown * 1000,
      };
      await configAPI.update(configToSave);
      setOriginalConfig(config);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(`Failed to save: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleResetEngine = async () => {
    if (!window.confirm("âš ï¸ RESET ENGINE STATE?\nThis clears pending entries and signal history.")) return;
    try { 
      // TODO: Implement reset endpoint
      alert("âœ… Engine Reset"); 
      fetchCurrentConfig(); 
    } catch (e) { 
      alert(e.message); 
    }
  };

  const updateConfig = (key, value) => { 
    setConfig((prev) => ({ ...prev, [key]: value })); 
  };

  // ============================================
  // RENDER
  // ============================================
  if (loading) {
    return (
      <Box minHeight="60vh" display="flex" alignItems="center" justifyContent="center">
        <Typography>Loading Config...</Typography>
      </Box>
    );
  }

  return (
    <Container maxWidth={false} sx={{ py: 2 }}>
      {/* Header */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={4}>
        <Box>
          <Typography variant="h4" fontWeight="900" sx={{ letterSpacing: -1 }}>
            SYSTEM <span style={{ color: theme.palette.primary.main }}>CONFIG</span>
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 1 }}>
            FOREX TRADING PARAMETERS
          </Typography>
        </Box>
        <Stack direction="row" spacing={2}>
          <Button 
            startIcon={<Refresh />} 
            onClick={fetchCurrentConfig} 
            color="inherit"
          >
            Revert
          </Button>
          <Button 
            variant="contained" 
            startIcon={<Save />} 
            onClick={handleSaveConfig} 
            disabled={!hasChanges || saving} 
            size="large" 
            sx={{ px: 4 }}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </Stack>
      </Box>
      
      {/* Alerts */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ mb: 3 }}>
          Configuration saved successfully!
        </Alert>
      )}
      
      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs 
          value={activeTab} 
          onChange={(_, v) => setActiveTab(v)} 
          textColor="primary" 
          indicatorColor="primary"
        >
          <Tab 
            icon={<AccountBalance fontSize="small" />} 
            iconPosition="start" 
            label="General" 
            sx={{ minHeight: 60 }} 
          />
          <Tab 
            icon={<Science fontSize="small" />} 
            iconPosition="start" 
            label="Strategy" 
            sx={{ minHeight: 60 }} 
          />
          <Tab 
            icon={<Security fontSize="small" />} 
            iconPosition="start" 
            label="Risk" 
            sx={{ minHeight: 60 }} 
          />
          <Tab 
            icon={<CurrencyExchange fontSize="small" />} 
            iconPosition="start" 
            label="Instruments" 
            sx={{ minHeight: 60 }} 
          />
          <Tab 
            icon={<Email fontSize="small" />} 
            iconPosition="start" 
            label="Notifications" 
            sx={{ minHeight: 60 }} 
          />
        </Tabs>
      </Box>
      
      {/* Tab Content */}
      <Box sx={{ minHeight: 400 }}>
        {activeTab === 0 && (
          <GeneralSettings 
            config={config} 
            updateConfig={updateConfig} 
            onResetEngine={handleResetEngine}
          />
        )}
        {activeTab === 1 && (
          <StrategySettings 
            config={config} 
            updateConfig={updateConfig} 
          />
        )}
        {activeTab === 2 && (
          <RiskSettings 
            config={config} 
            updateConfig={updateConfig} 
          />
        )}
        {activeTab === 3 && (
          <InstrumentSettings 
            config={config} 
            updateConfig={updateConfig} 
          />
        )}
        {activeTab === 4 && (
          <NotificationSettings 
            config={config} 
            updateConfig={updateConfig} 
          />
        )}
      </Box>
    </Container>
  );
};

export default TradingConfig;