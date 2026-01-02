// backend/src/routes/tradingRoutes.js - Trading API Routes with ConfigService
const express = require("express");
const router = express.Router();

// Oanda configuration
const OANDA_API_KEY = process.env.OANDA_API_KEY;
const OANDA_ACCOUNT_ID = process.env.OANDA_ACCOUNT_ID || "001-011-20128302-001";
const OANDA_BASE_URL =
    process.env.OANDA_ENVIRONMENT === "practice"
        ? "https://api-fxpractice.oanda.com"
        : "https://api-fxtrade.oanda.com";

// Helper: Make Oanda API request
async function oandaRequest(endpoint) {
    const response = await fetch(`${OANDA_BASE_URL}${endpoint}`, {
        headers: {
            Authorization: `Bearer ${OANDA_API_KEY}`,
            "Content-Type": "application/json",
        },
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Oanda API error: ${response.status} - ${error}`);
    }

    return response.json();
}

// Helper: Calculate pip value
function getPipValue(instrument) {
    return instrument.includes("JPY") ? 0.01 : 0.0001;
}

// ============ ROUTES ============

// Health check - INCLUDES CONFIG for dashboard
router.get("/health", (req, res) => {
    const dataService = req.app.locals.dataService;
    const signalGenerator = req.app.locals.signalGenerator;
    const configService = req.app.locals.configService;

    const config = configService ? configService.get() : {};

    res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        services: {
            api: true,
            oanda: !!OANDA_API_KEY,
            dataService: dataService?.isRunning || false,
            signalGenerator: signalGenerator?.isRunning || false,
        },
        // Include config for dashboard to read
        config: {
            enableTrading: config.enableTrading || false,
            assets: config.assets || [],
            strategy: config.strategy || "supertrend_momentum",
            timeframe: config.timeframe || "15m",
            minAdx: config.minAdx || 22,
            rsiOverbought: config.rsiOverbought || 75,
            maxOpenPositions: config.maxOpenPositions || 2,
            leverage: config.leverage || 10,
        },
    });
});

// Account info - LIVE from Oanda
router.get("/account", async (req, res) => {
    try {
        if (!OANDA_API_KEY) {
            return res
                .status(503)
                .json({ error: "Oanda API key not configured" });
        }

        const data = await oandaRequest(
            `/v3/accounts/${OANDA_ACCOUNT_ID}/summary`
        );
        const account = data.account;

        res.json({
            balance: parseFloat(account.balance),
            currency: account.currency,
            marginUsed: parseFloat(account.marginUsed),
            marginAvailable: parseFloat(account.marginAvailable),
            openTrades: account.openTradeCount,
            unrealizedPL: parseFloat(account.unrealizedPL),
            pl: parseFloat(account.pl),
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Live prices - Uses config assets
router.get("/prices", async (req, res) => {
    try {
        if (!OANDA_API_KEY) {
            return res
                .status(503)
                .json({ error: "Oanda API key not configured" });
        }

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

// Get candles for an instrument
router.get("/candles/:instrument", async (req, res) => {
    try {
        if (!OANDA_API_KEY) {
            return res
                .status(503)
                .json({ error: "Oanda API key not configured" });
        }

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

// Trading signals - from SignalGenerator
router.get("/signals", async (req, res) => {
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

// Portfolio / positions
router.get("/portfolio", async (req, res) => {
    try {
        if (!OANDA_API_KEY) {
            return res
                .status(503)
                .json({ error: "Oanda API key not configured" });
        }

        // Get account and open trades
        const [accountData, tradesData] = await Promise.all([
            oandaRequest(`/v3/accounts/${OANDA_ACCOUNT_ID}/summary`),
            oandaRequest(`/v3/accounts/${OANDA_ACCOUNT_ID}/openTrades`),
        ]);

        const account = accountData.account;
        const trades = tradesData.trades.map((t) => ({
            id: t.id,
            instrument: t.instrument,
            units: parseFloat(t.currentUnits),
            side: parseFloat(t.currentUnits) > 0 ? "BUY" : "SELL",
            entryPrice: parseFloat(t.price),
            unrealizedPL: parseFloat(t.unrealizedPL),
            marginUsed: parseFloat(t.marginUsed || 0),
            openTime: t.openTime,
        }));

        res.json({
            balance: parseFloat(account.balance),
            currency: account.currency,
            positions: trades,
            totalValue: parseFloat(account.NAV),
            unrealizedPnL: parseFloat(account.unrealizedPL),
            realizedPnL: parseFloat(account.pl),
            marginUsed: parseFloat(account.marginUsed),
            marginAvailable: parseFloat(account.marginAvailable),
            exposure: trades.length > 0 ? "Active" : "None",
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Trade history - from database
router.get("/trades", async (req, res) => {
    try {
        const TradeRepository = require("../repositories/tradeRepository");
        const tradeRepo = new TradeRepository();

        const limit = parseInt(req.query.limit) || 20;
        const mode = req.query.mode || "live";

        const trades = await tradeRepo.getRecent(limit, mode);

        res.json({
            trades,
            total: trades.length,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get config - from ConfigService
router.get("/config", (req, res) => {
    try {
        const configService = req.app.locals.configService;
        if (!configService) {
            return res
                .status(503)
                .json({ error: "ConfigService not available" });
        }
        res.json(configService.get());
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update config - via ConfigService (updates running services)
router.post("/config", (req, res) => {
    try {
        const configService = req.app.locals.configService;
        if (!configService) {
            return res
                .status(503)
                .json({ error: "ConfigService not available" });
        }

        const updatedConfig = configService.update(req.body);

        // Broadcast update to connected clients
        const broadcastConfig = req.app.locals.broadcastConfig;
        if (broadcastConfig) {
            broadcastConfig(updatedConfig);
        }

        res.json({
            success: true,
            config: updatedConfig,
            message: "Configuration updated and applied to services",
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Reset config to defaults
router.post("/config/reset", (req, res) => {
    try {
        const configService = req.app.locals.configService;
        if (!configService) {
            return res
                .status(503)
                .json({ error: "ConfigService not available" });
        }

        const defaultConfig = configService.reset();

        res.json({
            success: true,
            config: defaultConfig,
            message: "Configuration reset to defaults",
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Trading control endpoints
router.post("/trading/start", (req, res) => {
    try {
        const configService = req.app.locals.configService;
        if (configService) {
            configService.update({ enableTrading: true });
        }
        res.json({ success: true, message: "Trading enabled" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post("/trading/stop", (req, res) => {
    try {
        const configService = req.app.locals.configService;
        if (configService) {
            configService.update({ enableTrading: false });
        }
        res.json({ success: true, message: "Trading disabled" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Reset signal generator state
router.post("/trading/reset", (req, res) => {
    try {
        const signalGenerator = req.app.locals.signalGenerator;
        if (signalGenerator) {
            signalGenerator.reset();
        }
        res.json({ success: true, message: "Signal generator reset" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Force close a position
router.post("/trade/close/:id", async (req, res) => {
    try {
        const { id } = req.params;

        if (!OANDA_API_KEY) {
            return res
                .status(503)
                .json({ error: "Oanda API key not configured" });
        }

        // Close trade via Oanda API
        const response = await fetch(
            `${OANDA_BASE_URL}/v3/accounts/${OANDA_ACCOUNT_ID}/trades/${id}/close`,
            {
                method: "PUT",
                headers: {
                    Authorization: `Bearer ${OANDA_API_KEY}`,
                    "Content-Type": "application/json",
                },
            }
        );

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Failed to close trade: ${error}`);
        }

        const data = await response.json();

        res.json({
            success: true,
            message: `Position ${id} closed`,
            orderFillTransaction: data.orderFillTransaction,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
