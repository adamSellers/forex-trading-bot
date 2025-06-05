// frontend/src/App.jsx - Updated with custom theme
import React, { useState } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import {
  CssBaseline,
  AppBar,
  Toolbar,
  Typography,
  Box,
  Tabs,
  Tab
} from '@mui/material';
import {
  Dashboard,
  Settings,
  TrendingUp
} from '@mui/icons-material';
import TradingDashboard from './components/TradingDashboard';
import TradingConfig from './components/TradingConfig';
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

function App() {
  const [currentTab, setCurrentTab] = useState(0);

  const handleTabChange = (event, newValue) => {
    setCurrentTab(newValue);
  };

  return (
    <ThemeProvider theme={tradingTheme}>
      <CssBaseline />
      
      {/* Top Navigation */}
      <AppBar position="static" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar>
          <TrendingUp sx={{ mr: 2 }} />
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            Crypto Trend Trading Bot
          </Typography>
          
          <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <Tabs 
              value={currentTab} 
              onChange={handleTabChange}
              textColor="inherit"
              indicatorColor="secondary"
            >
              <Tab 
                icon={<Dashboard />} 
                label="Dashboard" 
                id="trading-tab-0"
                aria-controls="trading-tabpanel-0"
              />
              <Tab 
                icon={<Settings />} 
                label="Configuration" 
                id="trading-tab-1"
                aria-controls="trading-tabpanel-1"
              />
            </Tabs>
          </Box>
        </Toolbar>
      </AppBar>

      {/* Main Content */}
      <TabPanel value={currentTab} index={0}>
        <TradingDashboard />
      </TabPanel>
      
      <TabPanel value={currentTab} index={1}>
        <TradingConfig />
      </TabPanel>
    </ThemeProvider>
  );
}

export default App;