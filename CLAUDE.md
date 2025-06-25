# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 🚨 CRITICAL DEPLOYMENT WARNING 🚨

**DO NOT MODIFY THE CLEAN-INSTALL.SH SCRIPT WITHOUT EXTREME CAUTION**

The current `clean-install.sh` script has been battle-tested and successfully deploys on Raspberry Pi 5 with Node.js v22.16.0. Any changes to the deployment process should be thoroughly tested as previous attempts resulted in hanging installations due to ARM64 native module compilation issues.

## Development Commands

### Full Stack Development

-   `npm run dev` - Start both backend and frontend in development mode
-   `npm run dev:backend` - Start backend only (nodemon on port 3001)
-   `npm run dev:frontend` - Start frontend only (Vite on port 5173)

### Building and Production

-   `npm run build` - Build frontend for production
-   `npm run start` - Start both backend and frontend in production mode
-   `npm run serve` - Start backend production server only

### Database Operations

-   `npm run db:migrate` - Run database migrations (Knex)
-   `npm run db:seed` - Seed database with initial data
-   `cd backend && npm run db:rollback` - Rollback last migration

### Testing and Quality

-   `npm run test` - Run all tests (backend and frontend)
-   `npm run lint` - Run ESLint on both backend and frontend
-   Backend: No specific test framework configured yet
-   Frontend: Uses ESLint with React hooks and refresh plugins

### Deployment Scripts

-   `./scripts/deploy.sh` - Deploy to production
-   `./scripts/deploy-check.sh` - Pre-deployment validation
-   `./scripts/status.sh` - Check system status
-   `./scripts/logs.sh` - View application logs
-   `./scripts/monitor.sh` - Monitor system health

## Architecture Overview

### Core System Design

This is a **paper trading cryptocurrency bot** that simulates trading with $5,000 virtual USDT while monitoring real Binance market data. The system uses a multi-tiered architecture:

**Backend (Node.js/Express)**: Port 3001

-   REST API routes under `/api/trading` and `/api/management`
-   WebSocket server for real-time updates
-   SQLite database with Knex ORM for trade and portfolio data
-   PM2 process management in production

**Frontend (React/Vite)**: Port 5173 (dev), served via nginx (prod)

-   Material-UI dashboard components
-   Real-time WebSocket connection to backend
-   Recharts for data visualization

### Key Service Architecture

**SignalGenerator**: Analyzes technical indicators (EMA/SMA crossovers) to generate BUY/SELL/HOLD signals every minute using three strategies:

-   Conservative: 50/200 SMA crossover
-   Balanced: 20/50 EMA crossover
-   Responsive: 12/26 EMA crossover

**PaperTradingEngine**: Executes virtual trades based on signals with sophisticated risk management:

-   1% risk per trade ($50 max loss from $5K capital)
-   Portfolio allocation: 35% BTC, 35% ETH, 20% BNB, 10% DOGE
-   Stop losses calculated using 1.5x ATR
-   Daily loss limit: 2% ($100), Weekly: 5% ($250)

**BinanceDataService**: Provides real market data via Binance API (read-only, no actual trading)

### Database Schema Design

Uses SQLite with two main tables:

-   `trades`: Individual trade records with P&L, signal data, stop losses
-   `portfolio`: Portfolio snapshots with total value, USDT balance, position data

### WebSocket Real-time Updates

The system emits events for: price updates, signal generation, trade execution, portfolio changes, and system status updates.

## Production Deployment (Raspberry Pi 5)

### Hardware Requirements

-   **Device**: Raspberry Pi 5 Model B (4GB+ RAM recommended)
-   **OS**: Debian GNU/Linux (64-bit ARM)
-   **Architecture**: aarch64 (ARM64)
-   **Node.js**: v22.16.0 (CRITICAL - do not use older versions)
-   **Memory**: 8GB+ recommended for compilation

### Deployment Process

**IMPORTANT**: The deployment script has been optimized for Node.js v22 on ARM64 and should NOT be modified without extensive testing.

1. **Prerequisites Check**:

    ```bash
    node --version  # Must be v22.16.0+
    uname -m        # Must be aarch64
    free -h         # Check available memory
    ```

2. **Run Deployment**:

    ```bash
    chmod +x clean-install.sh
    ./clean-install.sh
    ```

3. **Key Deployment Features**:
    - Uses workspace scripts (`npm run install:backend`, `npm run build:frontend`)
    - Skips root dependency installation (only concurrently dev dependency)
    - Handles ARM64 native module compilation gracefully
    - Creates temporary swap for compilation
    - Installs Rollup ARM64 binary explicitly for Vite builds
    - Increases file descriptor limits for Material-UI icon compilation

### Known Issues & Solutions

#### 1. WebSocket Connection Failures

**Symptom**: Backend crashes with "WebSocket functionality not available"
**Solution**: The BinanceDataService should gracefully fall back to HTTP polling when WebSocket initialization fails.

#### 2. Frontend WebSocket Connection Errors

**Symptom**: Frontend shows "WebSocket connection failed" in console
**Cause**: Backend crashed, no Socket.IO server running
**Solution**: Fix backend WebSocket initialization or implement proper error handling

#### 3. ARM64 Compilation Issues

**Symptom**: npm install hangs at "npm rebuild"
**Solution**: Already handled in deployment script with `--ignore-scripts` flag

#### 4. File Descriptor Limits

**Symptom**: "EMFILE: too many open files" during Vite build
**Solution**: Already handled with `ulimit -n 65536` in deployment script

### Post-Deployment Verification

```bash
# Check application status
pm2 status
pm2 logs crypto-trend-bot

# Check API health
curl http://localhost:3001/api/management/health

# Check frontend
curl https://img.oakroad

# Monitor system resources
free -h
vcgencmd measure_temp
```

## Environment Configuration

### Required Environment Variables

-   `NODE_ENV` - Set to "production" for deployment
-   `PORT` - Backend server port (default: 3001)

#### Binance API

-   `BINANCE_API_KEY` and `BINANCE_API_SECRET` - For market data (read-only)
-   `USE_REAL_BINANCE_DATA` - Enable live market data

#### Database & Logging

-   `DB_PATH` - SQLite database file location
-   `DB_BACKUP_PATH` - Directory for database backups
-   `LOG_LEVEL` - Logging verbosity (e.g., "info")
-   `LOG_PATH` - Directory for log files

#### Security & Performance

-   `CORS_ORIGIN` - Comma-separated list of allowed origins
-   `RATE_LIMIT_WINDOW` & `RATE_LIMIT_MAX` - API rate limiting settings
-   `NODE_OPTIONS` - Node.js runtime options (e.g., `--max-old-space-size=512`)

#### Trading Safety

-   `MAX_DAILY_LOSS_OVERRIDE` - Override for daily loss percentage
-   `EMERGENCY_STOP_FILE` - Path to a file that, if present, halts trading

### PM2 Production Config

Uses `ecosystem.config.js` with the app name `crypto-trend-bot`. It is configured for a Raspberry Pi deployment under the `/opt/crypto-trading-bot` directory, with specific memory limits, restart policies, and log file paths.

## API Structure

### Trading Endpoints (`/api/trading/`)

-   `GET /status` - System status and initialization state
-   `GET /portfolio` - Current portfolio balance and positions
-   `GET /signals` - Recent trading signals with strength indicators
-   `GET /trades` - Trade history with pagination
-   `GET /prices` - Current market prices for all tracked assets
-   `POST /start`, `POST /stop` - Control trading engine
-   `POST /config` - Update trading configuration

### Management Endpoints (`/api/management/`)

-   `GET /health` - Detailed system health check
-   `GET /system` - System information and metrics
-   `GET /logs` - Application logs with filtering

## Paper Trading Workflow

1. **Signal Generation**: Every minute, analyze EMA/SMA crossovers for 4 assets
2. **Risk Assessment**: Calculate position size based on 1% risk rule
3. **Virtual Execution**: Record trade in database, update USDT balance
4. **Position Tracking**: Monitor unrealized P&L using live prices
5. **Stop Loss Management**: Close positions when stop loss triggered
6. **Performance Analytics**: Calculate win rate, profit factor, drawdown metrics

## Development Notes

### Frontend-Backend Communication

-   Development: Frontend (5173) → Backend (3001) via CORS
-   Production: nginx proxies `/api` requests to backend
-   WebSocket connections use same ports for real-time updates

### Code Conventions

-   Backend: CommonJS modules, Express routing patterns
-   Frontend: ES6 modules, React functional components with hooks
-   Database: Knex query builder with migration/seed system
-   Error handling: Centralized middleware with structured logging

### Testing Approach

-   No comprehensive test suite currently implemented
-   Manual testing via dashboard and API endpoints
-   Deployment validation through `deploy-check.sh` script

## Troubleshooting

### Backend Issues

-   **API Key Errors (`Invalid API-key...`)**:

    -   Ensure `BINANCE_API_KEY` and `BINANCE_API_SECRET` are correct
    -   In Binance API settings, ensure "Enable Reading" permissions
    -   Check IP restrictions and whitelist server IP

-   **WebSocket Connection Fails**:

    -   Check if `node-binance-api` WebSocket functionality is properly initialized
    -   Consider implementing fallback to HTTP polling
    -   Verify network connectivity and firewall settings

-   **Database Errors**:
    -   Check SQLite file permissions
    -   Verify database migrations have run
    -   Check disk space availability

### Frontend Issues

-   **Build Failures**:

    -   Ensure Node.js v22+ is being used
    -   Check file descriptor limits (`ulimit -n`)
    -   Verify all Rollup dependencies are installed

-   **WebSocket Connection Errors**:
    -   Verify backend is running and healthy
    -   Check nginx proxy configuration
    -   Ensure Socket.IO server is properly initialized

### Production Deployment Issues

-   **Installation Hangs**:

    -   DO NOT modify the working deployment script
    -   Check available memory and swap
    -   Verify Node.js version is v22.16.0+

-   **PM2 Process Crashes**:
    -   Check logs: `pm2 logs crypto-trend-bot`
    -   Verify environment variables are set
    -   Check system resources and file limits

## Current Status (as of latest deployment)

### ✅ Working Components

-   Node.js v22.16.0 deployment on Raspberry Pi 5
-   ARM64 native module compilation
-   Frontend build and serving via nginx
-   Database initialization and migrations
-   PM2 process management setup
-   API key encryption and storage

### ⚠️ Known Issues

-   Backend WebSocket initialization failing
-   Frontend unable to connect to Socket.IO server
-   BinanceDataService needs WebSocket fallback implementation

### 🔧 Next Steps

1. Fix WebSocket initialization in BinanceDataService
2. Implement HTTP polling fallback for price data
3. Test real-time data flow between frontend and backend
4. Verify trading signal generation and paper trading functionality

## Important Notes for Future Development

1. **DO NOT** modify the deployment script without extensive testing on ARM64
2. **ALWAYS** test WebSocket functionality changes in isolation
3. **VERIFY** that any dependency updates work on Node.js v22 + ARM64
4. **MAINTAIN** the current workspace structure and build process
5. **DOCUMENT** any changes to the production configuration thoroughly
