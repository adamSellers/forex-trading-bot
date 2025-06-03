import { useState, useEffect } from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { CssBaseline, Container, Typography, Box } from '@mui/material';
import io from 'socket.io-client';

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#00d4aa',
    },
    secondary: {
      main: '#ff6b6b',
    },
  },
});

function App() {
  const [connected, setConnected] = useState(false);
  const [serverStatus, setServerStatus] = useState(null);

  useEffect(() => {
    // Connect to backend
    const socket = io('http://localhost:3001');
    
    socket.on('connect', () => {
      setConnected(true);
      console.log('Connected to server');
    });

    socket.on('disconnect', () => {
      setConnected(false);
      console.log('Disconnected from server');
    });

    // Test API connection
    fetch('http://localhost:3001/api/health')
      .then(res => res.json())
      .then(data => setServerStatus(data))
      .catch(err => console.error('API connection failed:', err));

    return () => socket.disconnect();
  }, []);

  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <Container maxWidth="lg">
        <Box sx={{ py: 4 }}>
          <Typography variant="h3" component="h1" gutterBottom>
            Crypto Trend Trading Bot
          </Typography>
          
          <Box sx={{ mb: 2 }}>
            <Typography variant="body1">
              🔌 Socket Connection: {connected ? '✅ Connected' : '❌ Disconnected'}
            </Typography>
            <Typography variant="body1">
              🚀 API Status: {serverStatus ? '✅ Online' : '❌ Offline'}
            </Typography>
            {serverStatus && (
              <Typography variant="body2" color="text.secondary">
                Environment: {serverStatus.env} | Last Check: {new Date(serverStatus.timestamp).toLocaleTimeString()}
              </Typography>
            )}
          </Box>

          <Typography variant="h6" gutterBottom>
            Phase 1: Core Infrastructure ✅
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Project structure created, dependencies installed, basic server and frontend connected.
          </Typography>
        </Box>
      </Container>
    </ThemeProvider>
  );
}

export default App;