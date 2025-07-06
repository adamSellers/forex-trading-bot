# CLAUDE.md - AI Development & Troubleshooting Guide

## Project Overview

This is a production-ready cryptocurrency trading bot built with Node.js/React that implements automated signal generation and paper trading. The system is deployed on Raspberry Pi 5 with ARM64 optimization and operates 24/7 with comprehensive monitoring.

## Current System Status ✅

### **Production Environment**

-   **Platform**: Raspberry Pi 5 (Ubuntu 22.04 LTS ARM64)
-   **Node.js**: v22.16.0 (ARM64 native compilation)
-   **Process Manager**: PM2 with ecosystem configuration
-   **Web Server**: nginx with WebSocket proxying
-   **Database**: SQLite with migrations
-   **Deployment**: Automated via `clean-install.sh` script

### **Working Features**

-   ✅ **Real-time Data**: Binance WebSocket streams + HTTP polling fallback
-   ✅ **Signal Generation**: EMA/SMA crossover analysis with volatility filtering
-   ✅ **Paper Trading**: Virtual $5,000 USDT portfolio with risk management
-   ✅ **Live Dashboard**: React UI with Socket.IO real-time updates
-   ✅ **Production Deployment**: Stable operation with automatic recovery

## Development Workflow

### **Systematic Debugging Approach**

When working on issues, follow this methodology:

1. **Single Command Execution**: Issue one command at a time, wait for results
2. **Incremental Changes**: Make one modification per iteration, then test
3. **Preserve Functionality**: Never remove working features unless actively fixing them
4. **Use Project Knowledge**: Reference the loaded codebase for context and existing patterns.
5. **Tiered Deployments**: Use the correct deployment script for the job:
    - `scripts/update.sh`: For most small, daily updates. Fast and data-safe.
    - `scripts/deploy.sh`: For major updates requiring a full dependency reinstall.
    - `scripts/clean-install.sh`: For initial setup or a complete system reset.

### **Project Knowledge Usage**

The project knowledge contains the current production codebase. Always:

-   Search project knowledge FIRST before suggesting changes
-   Reference actual file structures and implementations
-   Understand the full context before proposing modifications
-   Maintain consistency with existing patterns

## Technical Architecture

### **Backend Services**

```
backend/src/
├── controllers/tradingController.js    # Service orchestration
├── services/
│   ├── binanceDataService.js          # Market data & WebSocket streams
│   ├── signalGenerator.js             # Technical analysis & signal generation
│   └── paperTradingEngine.js          # Virtual trading execution
├── repositories/                       # Database access layer
└── routes/                            # API endpoints
```

### **Frontend Components**

```
frontend/src/components/
├── TradingDashboard.jsx               # Main dashboard container
├── LivePrices.jsx                     # Real-time price display
├── TradingSignals.jsx                 # Signal visualization
├── PortfolioOverview.jsx              # Portfolio tracking
└── SystemStatusBanner.jsx             # System health indicator
```

### **Event-Driven Architecture**

The system uses EventEmitter pattern with Socket.IO for real-time communication:

```javascript
// Signal Generation Flow
signalGenerator.emit('signalGenerated', signal)
  → tradingController.emit('signalGenerated', signal)
  → socketIO.emit('signalGenerated', signal)
  → frontend receives via socket.on('signalGenerated')
```

## Common Issue Resolution

### **Signal Generation Issues**

**Problem**: Signals not appearing in frontend dashboard
**Root Cause**: Missing `start()` method in SignalGenerator class
**Solution**: Add periodic signal generation with `setInterval`

**Fixed Implementation**:

```javascript
start(binanceDataService, intervalMs = 60000) {
    this.isRunning = true;
    this.signalInterval = setInterval(() => {
        this.generateSignalCycle();
    }, intervalMs);
}
```

### **WebSocket Connection Issues**

**Problem**: Price updates not reaching frontend
**Root Cause**: Event emission to EventEmitter instead of Socket.IO
**Solution**: Ensure `socketIO.emit()` rather than `this.emit()`

**Debugging Commands**:

```bash
# Check WebSocket connectivity
pm2 logs crypto-trend-bot --lines 20 | grep -i "websocket\|socket"

# Monitor real-time events
pm2 logs crypto-trend-bot --follow | grep -E "📡|🚨|💼"
```

### **Production Deployment Issues**

**Problem**: Process fails to start after deployment
**Debugging Sequence**:

```bash
# 1. Check PM2 status
pm2 status crypto-trend-bot

# 2. View recent logs
pm2 logs crypto-trend-bot --lines 50

# 3. Check port conflicts
netstat -tulpn | grep :3001

# 4. Verify file permissions
ls -la /opt/crypto-trading-bot/

# 5. Test API endpoints
curl http://localhost:3001/api/management/health
```

## Known Issues & Solutions

### **Port Conflicts** ⚠️

**Symptom**: `EADDRINUSE` errors on startup
**Quick Fix**:

```bash
pm2 stop all && pm2 delete all
pm2 start ecosystem.config.js --env production
```

**Permanent Solution**: Implement better process cleanup in deployment scripts

### **API Authentication** ⚠️

**Status**: Using fallback data due to Binance API key issues
**Impact**: System continues normally with paper trading
**Mitigation**: Enhanced error handling prevents crashes

### **ARM64 Compilation** ✅

**Status**: Resolved with Node.js v22.16.0
**Solution**: Native ARM64 binaries, no more emulation issues
**Performance**: Significant improvement in build times and runtime efficiency

## Best Practices for AI Development

### **When Troubleshooting**

1. **Read Error Messages Carefully**: Parse logs systematically
2. **Isolate Variables**: Change one thing at a time
3. **Check Dependencies**: Verify all services are running
4. **Use Project Context**: Reference existing working implementations
5. **Test Incrementally**: Validate each change before proceeding

### **When Suggesting Code Changes**

1. **Search Project Knowledge First**: Understand existing patterns
2. **Maintain Code Style**: Follow established conventions
3. **Preserve Working Features**: Don't break unrelated functionality
4. **Add Comprehensive Logging**: Include debug statements for future troubleshooting
5. **Document Breaking Changes**: Explain impact on existing workflows

### **When Deploying Changes**

1. **Local Testing**: Verify changes work in development
2. **Clean Git State**: Commit all changes with descriptive messages
3. **Production Deployment**: Use `clean-install.sh` for consistency
4. **Health Verification**: Check logs and endpoints after deployment
5. **Rollback Plan**: Know how to revert if issues arise

## Monitoring & Health Checks

### **Real-time Monitoring**

```bash
# System health
curl http://localhost:3001/api/management/health

# Live log stream with filtering
pm2 logs crypto-trend-bot --follow | grep -E "✅|❌|⚠️|📡|🚨"

# Database status
sqlite3 /opt/crypto-trading-bot/data/trading_bot.db ".tables"
```

### **Performance Metrics**

-   **Signal Generation**: ~32 signals per session
-   **Data Streams**: 4 concurrent WebSocket connections
-   **Response Time**: Sub-second dashboard updates
-   **Memory Usage**: ~150MB stable operation
-   **CPU Usage**: <5% on Raspberry Pi 5

### **System Recovery**

```bash
# Full system restart
sudo systemctl restart nginx
pm2 restart ecosystem.config.js --env production

# Partial recovery (preserve data)
pm2 reload crypto-trend-bot

# Database reset (if needed)
npm run db:reset && npm run db:migrate
```

## Development Environment Setup

### **Local Development**

```bash
# Initial setup
git clone <repository>
cd crypto-trading-bot
npm install
cp backend/.env.example backend/.env

# Configure environment
# Edit backend/.env with your Binance API keys

# Start development
npm run dev  # Runs both backend and frontend
```

### **Production Deployment**

```bash
# On Raspberry Pi (from /opt/crypto-trading-bot)

# For most updates (fast, data-safe)
./scripts/update.sh

# For a full, clean installation (wipes data)
./scripts/clean-install.sh
```

## Future Development Notes

### **Architecture Improvements**

1. **Health Check Automation**: Implement automatic port conflict resolution
2. **Enhanced Monitoring**: Add Prometheus/Grafana integration
3. **Database Optimization**: Consider PostgreSQL for production scaling
4. **Multi-Exchange Support**: Abstract exchange interface for Coinbase/Kraken

### **Feature Enhancements**

1. **Advanced Indicators**: RSI, MACD, Bollinger Bands
2. **Machine Learning**: Signal prediction models
3. **Alert System**: Email/SMS notifications
4. **Portfolio Rebalancing**: Automated allocation adjustments

### **Deployment Enhancements**

1. **Docker Support**: Containerized deployment option
2. **CI/CD Pipeline**: Automated testing and deployment
3. **Blue-Green Deployment**: Zero-downtime updates
4. **Backup Automation**: Database and configuration backups

---

## Quick Reference Commands

```bash
# Health Check
curl http://localhost:3001/api/management/health

# View Logs
pm2 logs crypto-trend-bot --lines 50

# Restart Service
pm2 restart crypto-trend-bot

# Full Deployment
./scripts/clean-install.sh

# Database Migration
npm run db:migrate
```

This system represents a sophisticated, production-ready trading bot with comprehensive error handling, real-time data processing, and robust deployment infrastructure. All development should maintain this high standard of reliability and performance.
