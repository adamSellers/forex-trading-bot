// backend/src/routes/marketRoutes.js - Market Data Routes (Prices, Candles, Signals)
const express = require("express");
const router = express.Router();
const {
    OANDA_ACCOUNT_ID,
    oandaRequest,
    getPipValue,
    requireOandaApi,
} = require("./shared");

/**
 * GET /api/prices
 * Live prices for configured instruments
 */
router.get("/prices", requireOandaApi, async (req, res) => {
    try {
        // Get instruments from config or query param
        const configService = req.app.locals.configService;
        const configAssets = configService?.getValue("assets") || [
            "AUD_USD",
            "EUR_USD",
            "GBP_USD",
            "USD_JPY",
        ];
        const instruments = req.query.instruments || configAssets.join(",");

        const data = await oandaRequest(
            `/v3/accounts/${OANDA_ACCOUNT_ID}/pricing?instruments=${instruments}`
        );

        const prices = data.prices.map((price) => {
            const bid = parseFloat(price.bids?.[0]?.price || 0);
            const ask = parseFloat(price.asks?.[0]?.price || 0);
            const pipValue = getPipValue(price.instrument);
            const spread = (ask - bid) / pipValue;

            return {
                instrument: price.instrument,
                bid,
                ask,
                mid: (bid + ask) / 2,
                spread: parseFloat(spread.toFixed(1)),
                tradeable: price.tradeable,
                time: price.time,
            };
        });

        res.json({
            prices,
            timestamp: Date.now(),
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/candles/:instrument
 * Historical candles for an instrument
 */
router.get("/candles/:instrument", requireOandaApi, async (req, res) => {
    try {
        const { instrument } = req.params;
        const granularity = req.query.granularity || "M15";
        const count = req.query.count || 100;

        const data = await oandaRequest(
            `/v3/instruments/${instrument}/candles?granularity=${granularity}&count=${count}&price=M`
        );

        const candles = data.candles
            .filter((c) => c.complete)
            .map((c) => ({
                time: c.time,
                open: parseFloat(c.mid.o),
                high: parseFloat(c.mid.h),
                low: parseFloat(c.mid.l),
                close: parseFloat(c.mid.c),
                volume: c.volume,
            }));

        res.json({
            instrument,
            granularity,
            candles,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/signals
 * Current trading signals from SignalGenerator
 */
router.get("/signals", (req, res) => {
    try {
        const signalGenerator = req.app.locals.signalGenerator;

        if (!signalGenerator) {
            return res.json({ signals: [], timestamp: Date.now() });
        }

        const status = signalGenerator.getStatus();

        res.json({
            signals: status.activeSignals || [],
            pendingEntries: status.pendingEntries || [],
            isActive: status.isActive,
            config: {
                minAdx: status.config?.minAdx,
                timeframe: status.config?.timeframe,
                assets: status.config?.assets,
            },
            timestamp: Date.now(),
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
