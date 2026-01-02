// backend/src/routes/accountRoutes.js - Account, Portfolio, and Trade Routes
const express = require("express");
const router = express.Router();
const {
    OANDA_API_KEY,
    OANDA_ACCOUNT_ID,
    OANDA_BASE_URL,
    oandaRequest,
    requireOandaApi,
} = require("./shared");

/**
 * GET /api/account
 * Oanda account summary (balance, margin, etc.)
 */
router.get("/account", requireOandaApi, async (req, res) => {
    try {
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

/**
 * GET /api/portfolio
 * Portfolio overview with open positions
 */
router.get("/portfolio", requireOandaApi, async (req, res) => {
    try {
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

/**
 * GET /api/trades
 * Trade history from database
 */
router.get("/trades", async (req, res) => {
    try {
        let tradeRepo = req.app.locals.tradeRepository;

        // Fallback to creating new instance if not in app.locals
        if (!tradeRepo) {
            const TradeRepository = require("../repositories/tradeRepository");
            tradeRepo = new TradeRepository();
        }

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

/**
 * POST /api/trade/close/:id
 * Force close a position via Oanda
 */
router.post("/trade/close/:id", requireOandaApi, async (req, res) => {
    try {
        const { id } = req.params;

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

        // Sync trading engine after manual close
        const tradingEngine = req.app.locals.tradingEngine;
        if (tradingEngine) {
            await tradingEngine.syncWithOanda();
        }

        res.json({
            success: true,
            message: `Position ${id} closed`,
            orderFillTransaction: data.orderFillTransaction,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/trading/start
 * Enable trading
 */
router.post("/trading/start", (req, res) => {
    try {
        const configService = req.app.locals.configService;
        if (configService) {
            configService.update({ enableTrading: true });
        }

        // Broadcast engine status
        const broadcastEngineStatus = req.app.locals.broadcastEngineStatus;
        if (broadcastEngineStatus) broadcastEngineStatus();

        res.json({ success: true, message: "Trading enabled" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/trading/stop
 * Disable trading
 */
router.post("/trading/stop", (req, res) => {
    try {
        const configService = req.app.locals.configService;
        if (configService) {
            configService.update({ enableTrading: false });
        }

        // Broadcast engine status
        const broadcastEngineStatus = req.app.locals.broadcastEngineStatus;
        if (broadcastEngineStatus) broadcastEngineStatus();

        res.json({ success: true, message: "Trading disabled" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/trading/reset
 * Reset signal generator state
 */
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

module.exports = router;
