// frontend/src/components/dashboard/OpenPositions.jsx
import { useState } from 'react';
import {
    Box, Typography, Card, CardContent, Chip, Grid, Divider, 
    Button, CircularProgress, useTheme, alpha, Tooltip
} from '@mui/material';
import { TrendingUp, TrendingDown, AccessTime } from '@mui/icons-material';
import { EmptyState, formatCurrency, formatPrice } from './Shared';

export default function OpenPositions({ portfolio, prices = [] }) {
    const theme = useTheme();
    const positions = portfolio?.positions || [];

    if (positions.length === 0) {
        return (
            <EmptyState 
                icon={<AccessTime sx={{ fontSize: 64 }} />}
                message="NO OPEN POSITIONS"
                subMessage="Trades will appear here when opened"
            />
        );
    }

    return (
        <Box p={2}>
            {positions.map(position => (
                <PositionCard 
                    key={position.id} 
                    position={position} 
                    prices={prices}
                    theme={theme}
                />
            ))}
        </Box>
    );
}

function PositionCard({ position, prices, theme }) {
    const [closing, setClosing] = useState(false);
    
    const instrument = position.instrument;
    const displayName = instrument?.replace('_', '/');
    const units = Math.abs(position.units || 0);
    const side = position.side || (position.units > 0 ? 'BUY' : 'SELL');
    const isBuy = side === 'BUY';
    const pnl = position.unrealizedPL || 0;
    const isProfit = pnl >= 0;
    
    // Get current price from prices array
    const currentPriceData = prices.find(p => p.instrument === instrument);
    const currentPrice = currentPriceData?.mid || 0;
    const entryPrice = position.entryPrice || position.price;

    // Calculate P&L in pips
    const pipValue = instrument?.includes('JPY') ? 0.01 : 0.0001;
    const pnlPips = entryPrice && currentPrice 
        ? ((currentPrice - entryPrice) / pipValue) * (isBuy ? 1 : -1)
        : 0;

    const handleClose = async () => {
        if (!window.confirm(`Close ${displayName} position?`)) return;
        setClosing(true);
        try {
            await fetch(`/api/trade/close/${position.id}`, { method: 'POST' });
            // Position will be removed on next refresh
        } catch (e) {
            alert(`Failed to close: ${e.message}`);
        } finally {
            setClosing(false);
        }
    };

    return (
        <Card 
            variant="outlined" 
            sx={{ 
                mb: 2, 
                bgcolor: alpha(isProfit ? theme.palette.success.main : theme.palette.error.main, 0.05),
                borderColor: alpha(isProfit ? theme.palette.success.main : theme.palette.error.main, 0.2)
            }}
        >
            <CardContent sx={{ p: '16px !important' }}>
                {/* Header */}
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                    <Box display="flex" alignItems="center" gap={1.5}>
                        <Chip 
                            label={displayName}
                            color={isBuy ? 'success' : 'error'}
                            size="small"
                            sx={{ fontWeight: 'bold' }}
                        />
                        <Chip 
                            label={side}
                            variant="outlined"
                            size="small"
                            color={isBuy ? 'success' : 'error'}
                            sx={{ fontWeight: 'bold' }}
                        />
                        <Typography variant="body2" color="text.secondary">
                            {units.toLocaleString()} units
                        </Typography>
                    </Box>
                    <Box textAlign="right">
                        <Typography 
                            variant="h6" 
                            fontWeight="bold"
                            sx={{ 
                                color: isProfit ? 'success.main' : 'error.main',
                                fontFamily: 'monospace'
                            }}
                        >
                            {isProfit ? '+' : ''}{formatCurrency(pnl)}
                        </Typography>
                        <Typography 
                            variant="caption" 
                            sx={{ 
                                color: isProfit ? 'success.main' : 'error.main',
                                fontFamily: 'monospace'
                            }}
                        >
                            {pnlPips >= 0 ? '+' : ''}{pnlPips.toFixed(1)} pips
                        </Typography>
                    </Box>
                </Box>

                <Divider sx={{ my: 1.5 }} />

                {/* Price Grid */}
                <Grid container spacing={2} alignItems="center">
                    <Grid item xs={3}>
                        <Typography variant="caption" color="text.secondary" display="block">
                            Entry
                        </Typography>
                        <Typography variant="body2" fontWeight="bold" fontFamily="monospace">
                            {formatPrice(entryPrice, instrument)}
                        </Typography>
                    </Grid>
                    <Grid item xs={3}>
                        <Typography variant="caption" color="text.secondary" display="block">
                            Current
                        </Typography>
                        <Typography 
                            variant="body2" 
                            fontWeight="bold" 
                            fontFamily="monospace"
                            sx={{ color: isProfit ? 'success.main' : 'error.main' }}
                        >
                            {formatPrice(currentPrice, instrument)}
                        </Typography>
                    </Grid>
                    <Grid item xs={3}>
                        <Typography variant="caption" color="text.secondary" display="block">
                            Margin Used
                        </Typography>
                        <Typography variant="body2" fontWeight="bold" fontFamily="monospace">
                            {formatCurrency(position.marginUsed || 0)}
                        </Typography>
                    </Grid>
                    <Grid item xs={3} textAlign="right">
                        <Button
                            variant="contained"
                            color="error"
                            size="small"
                            onClick={handleClose}
                            disabled={closing}
                            sx={{ minWidth: 80, fontWeight: 'bold' }}
                        >
                            {closing ? <CircularProgress size={16} color="inherit" /> : 'CLOSE'}
                        </Button>
                    </Grid>
                </Grid>

                {/* Open Time */}
                {position.openTime && (
                    <Box mt={1.5} display="flex" alignItems="center" gap={0.5}>
                        <AccessTime sx={{ fontSize: 14, color: 'text.secondary' }} />
                        <Typography variant="caption" color="text.secondary">
                            Opened: {new Date(position.openTime).toLocaleString()}
                        </Typography>
                    </Box>
                )}
            </CardContent>
        </Card>
    );
}