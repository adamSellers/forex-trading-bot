// frontend/src/App.jsx - Forex Trading Bot
import React from 'react';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { tradingTheme } from './theme/tradingTheme';
import TradingDashboard from './components/TradingDashboard';
import ErrorBoundary from './components/ErrorBoundary';

function App() {
  return (
    <ThemeProvider theme={tradingTheme}>
      <CssBaseline />
      <ErrorBoundary>
        <TradingDashboard />
      </ErrorBoundary>
    </ThemeProvider>
  );
}

export default App;