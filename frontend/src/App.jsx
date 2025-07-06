// frontend/src/App.jsx - Refactored for better layout and responsiveness
import React, { useState } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import {
  CssBaseline,
  AppBar,
  Toolbar,
  Typography,
  Box,
  Tabs,
  Tab,
  useTheme,
  useMediaQuery,
  Container
} from '@mui/material';
import {
  Dashboard,
  Settings,
  TrendingUp, // This is the logo icon
  Assessment,
  MonitorHeart // New icon for health
} from '@mui/icons-material';
import TradingDashboard from './components/TradingDashboard';
import TradingConfig from './components/TradingConfig';
import AnalyticsDashboard from './components/AnalyticsDashboard';
import SystemHealth from './components/SystemHealth'; // New import
import ErrorBoundary from './components/ErrorBoundary';
import { tradingTheme } from './theme/tradingTheme';

function TabPanel({ children, value, index, ...other }) {
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`trading-tabpanel-${index}`}
      aria-labelledby={`trading-tab-${index}`}
      {...other}
    >
      {value === index && children}
    </div>
  );
}

const AppContent = () => {
  const [currentTab, setCurrentTab] = useState(0);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        {/* Top Navigation */}
        <AppBar position="sticky" elevation={1} color="default">
          <Toolbar>
            <TrendingUp sx={{ mr: 2, color: 'primary.main' }} />
            <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
              Crypto Trend Trading Bot
            </Typography>
          </Toolbar>
        </AppBar>

        {/* Tab Navigation */}
        <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
          <Tabs
            value={currentTab}
            onChange={(event, newValue) => setCurrentTab(newValue)}
            variant={isMobile ? 'scrollable' : 'standard'}
            scrollButtons="auto"
            centered={!isMobile}
            aria-label="navigation tabs"
          >
            <Tab
              icon={<Dashboard />}
              label="Dashboard"
              id="trading-tab-0"
              aria-controls="trading-tabpanel-0"
            />
            <Tab
              icon={<Assessment />}
              label="Analytics"
              id="trading-tab-1"
              aria-controls="trading-tabpanel-1"
            />
            <Tab
              icon={<Settings />}
              label="Configuration"
              id="trading-tab-2"
              aria-controls="trading-tabpanel-2"
            />
            <Tab
              icon={<MonitorHeart />}
              label="System Health"
              id="trading-tab-3"
              aria-controls="trading-tabpanel-3"
            />
          </Tabs>
        </Box>

        {/* Main Content Area */}
        <Box component="main" sx={{ flexGrow: 1, bgcolor: 'background.default', py: 3 }}>
          <Container maxWidth="xl">
            <TabPanel value={currentTab} index={0}>
              <ErrorBoundary>
                <TradingDashboard />
              </ErrorBoundary>
            </TabPanel>
            
            <TabPanel value={currentTab} index={1}>
              <ErrorBoundary>
                <AnalyticsDashboard />
              </ErrorBoundary>
            </TabPanel>

            <TabPanel value={currentTab} index={2}>
              <ErrorBoundary>
                <TradingConfig />
              </ErrorBoundary>
            </TabPanel>

            <TabPanel value={currentTab} index={3}>
              <ErrorBoundary>
                <SystemHealth />
              </ErrorBoundary>
            </TabPanel>
          </Container>
        </Box>
    </Box>
  );
};

function App() {
  return (
    <ThemeProvider theme={tradingTheme}>
      <CssBaseline />
      <AppContent />
    </ThemeProvider>
  );
}


export default App;
