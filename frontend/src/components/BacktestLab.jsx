// frontend/src/components/BacktestLab.jsx - V3.2.6 LIVE PARITY UPDATE
import React, { useState, useEffect } from 'react';
import { Box, Typography, Grid, Alert, AlertTitle, useTheme } from '@mui/material';
import { socket } from '../config/api';

// --- SUB-COMPONENTS ---
import LabControls from './lab/LabControls';
import SimulationReport from './lab/SimulationReport';
import OptimizationReport from './lab/OptimizationReport';
import { LoadingState, EmptyState } from './lab/LabStates';

const BacktestLab = () => {
    const theme = useTheme();
    const [running, setRunning] = useState(false);
    const [optimizing, setOptimizing] = useState(false);
    const [progress, setProgress] = useState({ percent: 0, message: '' });
    
    const [results, setResults] = useState(null);
    const [optimizationReport, setOptimizationReport] = useState(null);
    const [error, setError] = useState(null);

    // --- CONFIG STATE (V3.2.6 - Matches Live Trading) ---
    const [config, setConfig] = useState({
        // Entry Filters (match signalGenerator.js)
        minAdx: 22,
        rsiOverbought: 75,
        rsiOversold: 30,
        
        // Position Sizing (match LiveTradingEngine.js)
        balance: 1000,
        riskPerTrade: 0.02,
        
        // Stop Loss
        stopLossType: 'ATR',
        stopLoss: 2.0,
        stopLossATR: 2.0,
        
        // Trailing Stops
        enableTrailingStops: true,
        trailingStopPercent: 0.03,
        
        // Exposure cap
        maxPortfolioExposure: 0.5,
        
        // FIX #6: Continuation Entry (NEW)
        enableContinuationEntry: true,
        continuationWindowMs: 4 * 60 * 60 * 1000, // 4 hours
        continuationRsiThreshold: 70,
        continuationMaxPriceDeviation: 0.005,
        
        // Trading Costs & Slippage
        spreadPips: 1.5,
        commissionPerSide: 0,
        enableSlippage: true,
        slippagePct: 0.0005,  // 0.05%
        
        // Simulation Settings
        days: 30,
        burstMode: false,
        
        // Portfolio
        assets: ['AUD_USD', 'EUR_USD'],
        weights: { AUD_USD: 50, EUR_USD: 50 }
    });

    // --- WEBSOCKET LISTENERS ---
    useEffect(() => {
        const onProgress = (data) => setProgress(data);
        const onComplete = (data) => {
            setResults(data);
            setOptimizationReport(null);
            setRunning(false);
            setProgress({ percent: 100, message: 'Simulation Complete' });
        };
        const onOptComplete = (data) => {
            setOptimizationReport(data);
            setResults(null);
            setOptimizing(false);
            setProgress({ percent: 100, message: 'Optimization Complete' });
        };
        const onError = (err) => {
            setError(err.message);
            setRunning(false);
            setOptimizing(false);
        };

        socket.on('simulation_progress', onProgress);
        socket.on('simulation_complete', onComplete);
        socket.on('simulation_error', onError);
        socket.on('optimization_progress', onProgress);
        socket.on('optimization_complete', onOptComplete);
        socket.on('optimization_error', onError);

        return () => {
            socket.off('simulation_progress', onProgress);
            socket.off('simulation_complete', onComplete);
            socket.off('simulation_error', onError);
            socket.off('optimization_progress', onProgress);
            socket.off('optimization_complete', onOptComplete);
            socket.off('optimization_error', onError);
        };
    }, []);

    // --- HANDLERS ---
    const handleRun = (forceRebuild = false) => {
        setRunning(true);
        setOptimizing(false);
        setResults(null);
        setOptimizationReport(null);
        setError(null);
        setProgress({ percent: 0, message: forceRebuild ? 'Reinitializing Data...' : 'Initializing Worker...' });
        socket.emit('start_simulation', { ...config, forceRebuild });
    };

    const handleOptimize = () => {
        setOptimizing(true);
        setRunning(false);
        setResults(null);
        setOptimizationReport(null);
        setError(null);
        setProgress({ percent: 0, message: 'Booting Genetic Screener...' });
        socket.emit('start_optimization', { ...config });
    };
    
    const handleCancel = () => {
        socket.emit('cancel_optimization');
        setOptimizing(false);
        setRunning(false);
        setProgress({ percent: 0, message: '' });
    };

    const applyOptimizedConfig = () => {
        if (!optimizationReport) return;
        const newAssets = optimizationReport.optimizedPortfolio.assets;
        const weight = parseFloat((100 / newAssets.length).toFixed(1));
        const newWeights = {};
        newAssets.forEach(a => newWeights[a] = weight);
        setConfig(prev => ({ ...prev, assets: newAssets, weights: newWeights }));
    };

    // --- HELPERS FOR CONTROLS ---
    const updateConfig = (f, v) => setConfig(p => ({ ...p, [f]: v }));
    const updateWeight = (a, v) => setConfig(p => ({ ...p, weights: { ...p.weights, [a]: parseFloat(v) || 0 } }));
    
    const addAsset = (a) => {
        if (!a || config.assets.includes(a)) return;
        const newAssets = [...config.assets, a];
        const w = parseFloat((100 / newAssets.length).toFixed(1));
        const newWeights = {};
        newAssets.forEach(as => newWeights[as] = w);
        setConfig(p => ({ ...p, assets: newAssets, weights: newWeights }));
    };

    const removeAsset = (a) => {
        const newAssets = config.assets.filter(as => as !== a);
        const newWeights = { ...config.weights };
        delete newWeights[a];
        setConfig(p => ({ ...p, assets: newAssets, weights: newWeights }));
    };

    return (
        <Box 
            p={3} 
            height="100%" 
            width="100%" 
            display="flex" 
            flexDirection="column" 
            sx={{ overflowY: 'auto', overflowX: 'hidden' }}
        >
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={4}>
                <Box>
                    <Typography variant="h4" fontWeight="900" sx={{ letterSpacing: -1 }}>
                        STRATEGY <span style={{ color: theme.palette.primary.main }}>LAB</span>
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 1 }}>
                        ISOLATED SIMULATION • LIVE PARITY MODE • 15M TIMEFRAME
                    </Typography>
                </Box>
            </Box>

            <Grid container spacing={3} sx={{ width: '100%', m: 0 }}>
                <Grid item xs={12} md={4} lg={3} sx={{ pl: '0 !important', pt: '0 !important' }}>
                    <LabControls 
                        config={config}
                        updateConfig={updateConfig}
                        updateWeight={updateWeight}
                        addAsset={addAsset}
                        removeAsset={removeAsset}
                        onRun={handleRun}
                        onOptimize={handleOptimize}
                        onCancel={handleCancel}
                        running={running}
                        optimizing={optimizing}
                    />
                </Grid>
                
                <Grid item xs={12} md={8} lg={9} sx={{ pt: '0 !important' }}>
                    {error && (
                        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
                            <AlertTitle>Error</AlertTitle>
                            {error}
                        </Alert>
                    )}
                     
                    {(running || optimizing) && (
                        <LoadingState 
                            message={progress.message} 
                            percent={progress.percent} 
                            isOptimizing={optimizing}
                            onCancel={handleCancel}
                        />
                    )}
                     
                    {!running && !optimizing && !results && !optimizationReport && <EmptyState />}
                     
                    {results && !optimizing && <SimulationReport results={results} />}
                     
                    {optimizationReport && !running && (
                        <OptimizationReport report={optimizationReport} onApply={applyOptimizedConfig} />
                    )}
                </Grid>
            </Grid>
        </Box>
    );
};

export default BacktestLab;
