// backend/src/routes/index.js - Main Router (combines all sub-routers)
const express = require("express");
const router = express.Router();

// Import sub-routers
const systemRoutes = require("./systemRoutes");
const marketRoutes = require("./marketRoutes");
const accountRoutes = require("./accountRoutes");
const configRoutes = require("./configRoutes");
const engineRoutes = require("./engineRoutes");
const analyticsRoutes = require("./analyticsRoutes");

// Mount sub-routers
router.use("/", systemRoutes); // /api/health, /api/system/*
router.use("/", marketRoutes); // /api/prices, /api/candles, /api/signals
router.use("/", accountRoutes); // /api/account, /api/portfolio, /api/trades
router.use("/config", configRoutes); // /api/config/*
router.use("/engine", engineRoutes); // /api/engine/*
router.use("/", analyticsRoutes); // /api/analytics

module.exports = router;
