// frontend/src/App.jsx - Forex Trading Bot with Navigation
import React, { useState } from 'react';
import { ThemeProvider, CssBaseline, Box } from '@mui/material';
import { tradingTheme } from './theme/tradingTheme';
import TradingDashboard from './components/TradingDashboard';
import AnalyticsDashboard from './components/AnalyticsDashboard';
import TradingConfig from './components/TradingConfig';
import SystemHealth from './components/SystemHealth';
import Navigation from './components/Navigation';
import ErrorBoundary from './components/ErrorBoundary';
import OperatorAuthGate from './components/OperatorAuthGate';

// Navigation views
const VIEWS = {
  DASHBOARD: 'dashboard',
  ANALYTICS: 'analytics',
  SYSTEM: 'system',
  SETTINGS: 'settings',
};

function App() {
  const [currentView, setCurrentView] = useState(VIEWS.DASHBOARD);

  const renderView = () => {
    switch (currentView) {
      case VIEWS.ANALYTICS:
        return <AnalyticsDashboard />;
      case VIEWS.SYSTEM:
        return <SystemHealth />;
      case VIEWS.SETTINGS:
        return <TradingConfig />;
      case VIEWS.DASHBOARD:
      default:
        return <TradingDashboard />;
    }
  };

  return (
    <ThemeProvider theme={tradingTheme}>
      <CssBaseline />
      <ErrorBoundary>
        <OperatorAuthGate>
        <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
          <Navigation 
            currentView={currentView} 
            onViewChange={setCurrentView} 
            views={VIEWS}
          />
          <Box sx={{ flexGrow: 1, overflow: 'auto' }}>
            {renderView()}
          </Box>
        </Box>
        </OperatorAuthGate>
      </ErrorBoundary>
    </ThemeProvider>
  );
}

export default App;
