// frontend/src/components/SignalsWidget.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { Paper, Box, Typography, Chip, Alert, CircularProgress } from '@mui/material';
import { io } from 'socket.io-client';
import { tradingAPI, SOCKET_URL } from '../../config/api';
import SignalCard from './SignalCard';
import { AllInclusive, CheckCircleOutline, ErrorOutline } from '@mui/icons-material';

const SignalsWidget = () => {
    // FIX: Map key is now `${symbol}_${timeframe}` to support multiple timeframes per asset
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
                        // Create unique key based on symbol AND timeframe
                        // fallback to '1h' if timeframe is missing to maintain legacy compatibility
                        const tf = signal.timeframe || '1h';
                        const key = `${signal.symbol}_${tf}`;

                        const existing = newMap.get(key);
                        // Update if new signal is newer than existing one for this specific timeframe
                        if (!existing || new Date(signal.timestamp) >= new Date(existing.timestamp)) {
                            newMap.set(key, signal);
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

    // Memoize and sort: Alphabetical by Symbol, then by Timeframe
    const signalsToRender = useMemo(() => {
        return Array.from(latestSignals.values()).sort((a, b) => {
            const symbolComp = a.symbol.localeCompare(b.symbol);
            if (symbolComp !== 0) return symbolComp;
            return (a.timeframe || '').localeCompare(b.timeframe || '');
        });
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
                        <SignalCard 
                            key={`${signal.symbol}_${signal.timeframe || '1h'}_${signal.timestamp}`} 
                            signal={signal} 
                        />
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