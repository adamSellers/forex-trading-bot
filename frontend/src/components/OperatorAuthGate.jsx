import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Paper, Stack, TextField, Typography } from '@mui/material';
import { operatorAuth, AUTH_REQUIRED_EVENT } from '../config/operatorAuth';
import { socket } from '../config/api';

export default function OperatorAuthGate({ children }) {
  const [status, setStatus] = useState(null);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await operatorAuth.status();
      setStatus(next);
      setError('');
      if (!next.authenticated) socket.disconnect();
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const requireLogin = () => {
      socket.disconnect();
      setStatus((previous) => ({ ...previous, authenticated: false }));
      refresh();
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, requireLogin);
    const timer = setInterval(refresh, 60000);
    return () => {
      clearInterval(timer);
      window.removeEventListener(AUTH_REQUIRED_EVENT, requireLogin);
    };
  }, [refresh]);

  const login = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const suppliedToken = token.trim();
    setToken('');
    try {
      const session = await operatorAuth.login(suppliedToken);
      setStatus({ configured: true, ...session });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    try {
      await operatorAuth.logout();
      setStatus({ configured: true, authenticated: false });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (status?.authenticated) {
    return <>
      <Box display="flex" alignItems="center" justifyContent="flex-end" gap={2} px={2} py={0.5}>
        <Typography variant="caption" color="text.secondary">Operator signed in</Typography>
        <Button size="small" disabled={busy} onClick={logout}>Sign out</Button>
      </Box>
      {error && <Alert severity="error">{error}</Alert>}
      {children}
    </>;
  }

  return <Box minHeight="100vh" display="flex" alignItems="center" justifyContent="center" p={3}>
    <Paper component="form" onSubmit={login} sx={{ p: 4, maxWidth: 440, width: '100%' }}>
      <Stack spacing={2}>
        <Typography variant="h5">Forex operator access</Typography>
        {!status && !error ? <CircularProgress size={28} /> : <>
          {status?.configured === false && <Alert severity="warning">
            Operator access needs to be configured on the server before this application can be used.
          </Alert>}
          {status?.requiresHttps && <Alert severity="warning">Open the HTTPS dashboard to sign in.</Alert>}
          {error && <Alert severity="error">{error}</Alert>}
          {status?.configured && !status?.requiresHttps && <>
            <Typography variant="body2" color="text.secondary">
              Enter your operator access token. Signing in gives access to account information and live trading controls.
            </Typography>
            <TextField label="Operator access token" type="password" value={token}
              onChange={(event) => setToken(event.target.value)} autoComplete="off"
              required fullWidth autoFocus disabled={busy} />
            <Button type="submit" variant="contained" disabled={busy || !token.trim()}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </>}
          <Button onClick={refresh} disabled={busy}>Check connection</Button>
        </>}
      </Stack>
    </Paper>
  </Box>;
}
