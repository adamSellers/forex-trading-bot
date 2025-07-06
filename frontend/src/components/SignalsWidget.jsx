import React, { useState, useEffect, useMemo } from 'react';
import { Paper, Box, Typography, Chip, Alert, CircularProgress } from '@mui/material';
import { io } from 'socket.io-client';
import { tradingAPI, SOCKET_URL } from '../../config/api';
import SignalCard from './SignalCard';
import { AllInclusive, CheckCircleOutline, ErrorOutline } from '@mui/icons-material';

const SignalsWidget = () => {
    // THE FIX: Use a Map to store only the latest signal for each symbol
    const [latestSignals, setLatestSignals] = useState(new Map());
    const [status, setStatus] = useState({ loading: true, message: 'Initializing...' });
    const [totalSignalCount, setTotalSignalCount] = useState(0);

    useEffect(() => {
        // Function to update the signal map state
        const updateSignalState = (signals) => {
            if (!Array.isArray(signals)) return;

            setLatestSignals(prevMap => {
                const newMap = new Map(prevMap);
                signals.forEach(signal => {
                    if (signal && signal.symbol) {
                        // Only update if the new signal is more recent
                        const existing = newMap.get(signal.symbol);
                        if (!existing || new Date(signal.timestamp) >= new Date(existing.timestamp)) {
                            newMap.set(signal.symbol, signal);
                        }
                    }
                });
                return newMap;
            });
        };

        // Fetch initial data
        const fetchInitialData = async () => {
            try {
                setStatus({ loading: true, message: 'Fetching recent signals...' });
                const response = await tradingAPI.getSignals({ limit: 100 });
                updateSignalState(response.signals);
                setTotalSignalCount(response.count);
                setStatus({ loading: false, message: 'Live' });
            } catch (error) {
                setStatus({ loading: false, message: `Error: ${error.message}` });
                console.error("Failed to fetch initial signals:", error);
            }
        };

        fetchInitialData();

        // Setup WebSocket connection
        const socket = io(SOCKET_URL, {
            reconnection: true,
            reconnectionAttempts: 5,
        });

        socket.on('connect', () => {
            console.log('Socket connected for signals');
            setStatus(prev => ({ ...prev, message: 'Live' }));
        });

        // Listen for the batch event which is more efficient
        socket.on('allSignalsGenerated', (newSignals) => {
            updateSignalState(newSignals);
            setTotalSignalCount(prev => prev + newSignals.length);
        });

        socket.on('disconnect', () => {
            setStatus(prev => ({ ...prev, message: 'Disconnected. Reconnecting...' }));
        });

        // Cleanup on component unmount
        return () => {
            socket.disconnect();
        };
    }, []);

    // Memoize the sorted array of signals to prevent re-sorting on every render
    const signalsToRender = useMemo(() => {
        return Array.from(latestSignals.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
    }, [latestSignals]);

    return (
        <Paper elevation={1}>
            <Box sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: 1, borderColor: 'divider' }}>
                <Typography variant="h6">Trading Signals</Typography>
                <Box>
                    {status.loading ? (
                        <Chip icon={<CircularProgress size={16} />} label="Loading..." size="small" color="info" />
                    ) : (
                        <Chip icon={<CheckCircleOutline />} label={status.message} size="small" color={status.message === 'Live' ? 'success' : 'warning'} />
                    )}
                    <Chip icon={<AllInclusive />} label={`${totalSignalCount} total`} size="small" color="primary" sx={{ ml: 1 }} />
                </Box>
            </Box>

            {status.loading && signalsToRender.length === 0 && (
                <Box sx={{ p: 3, textAlign: 'center' }}>
                    <CircularProgress />
                    <Typography>Loading Signals...</Typography>
                </Box>
            )}

            {!status.loading && signalsToRender.length === 0 && (
                <Alert severity="info" sx={{ m: 2 }}>
                    Waiting for the first signals from the server. This may take a minute.
                </Alert>
            )}

            {signalsToRender.length > 0 && (
                <Box sx={{ p: 2, maxHeight: '400px', overflowY: 'auto' }}>
                    {signalsToRender.map(signal => (
                        <SignalCard key={signal.symbol} signal={signal} />
                    ))}
                </Box>
            )}

            <Box sx={{ p: 1, backgroundColor: 'action.hover', borderTop: 1, borderColor: 'divider' }}>
                <Typography variant="caption" color="text.secondary">
                    {`Last update: ${new Date().toLocaleTimeString()}`}
                </Typography>
            </Box>
        </Paper>
    );
};

export default SignalsWidget;