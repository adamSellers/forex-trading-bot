# Scripts Directory Documentation

This directory contains deployment, maintenance, and utility scripts for the Forex Trading Bot. All scripts are designed for Mac Mini deployment unless otherwise noted.

---

## Setup & Deployment Scripts

### `first_time_setup.sh`
**Purpose:** Complete first-time installation and setup of the forex trading bot on a Mac Mini.

**What it does:**
- Validates user permissions (prevents running as root)
- Clones repository from GitHub (`mac-mini` branch)
- Installs backend and frontend dependencies
- Builds frontend for production
- Sets up SQLite database with migrations
- Configures encrypted secrets (interactive prompts for Oanda credentials)
- Registers application with PM2 for production deployment
- Runs health check to verify installation

**When to use:**
- First time setting up the bot on a new Mac Mini
- Complete fresh installation
- After a system reset

**When NOT to use:**
- For updates (use `deploy.sh` instead)
- If bot is already installed (use `deploy.sh` for updates)

**Prerequisites:**
- Node.js 18+
- PM2 installed globally
- Git SSH access to repository
- Sudo access
- Oanda API credentials

---

### `deploy.sh`
**Purpose:** Deploy updates to an existing installation without wiping data.

**What it does:**
- Fetches latest code from `mac-mini` branch
- Stops PM2 service temporarily
- Creates database backup
- Installs/updates dependencies
- Builds frontend (if needed)
- Runs database migrations
- Restarts PM2 service
- Verifies health check

**When to use:**
- Deploying code updates
- After pulling changes from GitHub
- Regular maintenance updates

**Key features:**
- Preserves existing data and configuration
- Creates automatic backups before deployment
- macOS compatible (no ARM64 Rollup installation)
- Cleans up old backups (keeps last 7)

---

### `deploy_crypti.sh`
**Purpose:** Deployment script for the crypto trading bot (companion bot).

**What it does:**
- Similar to `deploy.sh` but for crypto bot
- Deploys to `/opt/crypto-trading-bot`
- Handles ARM64 Rollup installation conditionally (Linux only)
- Reloads Nginx if on Linux
- Uses crypto bot specific health endpoints

**When to use:**
- Updating the crypto trading bot
- Part of dual-bot deployment setup

**Note:** This script is for the crypto bot, not the forex bot. It's included here for reference in dual-bot deployments.

---

### `deploy-check.sh`
**Purpose:** Pre-deployment validation checks to ensure code is ready.

**What it does:**
- Verifies git status is clean
- Checks branch is up to date
- Tests frontend builds successfully
- Validates backend dependencies
- Tests local API endpoints (if running)
- Checks workspace configuration

**When to use:**
- Before deploying to production
- CI/CD pipeline validation
- Pre-commit checks

**Exit codes:**
- `0` - All checks passed
- `1` - One or more checks failed

---

## Backup & Restore Scripts

### `backup.sh`
**Purpose:** Create timestamped backups of the application state.

**What it does:**
- Creates full backup archive (code + data, excludes node_modules)
- Creates database-only backup (quick restore option)
- Optionally stops service for consistent backup (`--cold` flag)
- Cleans old backups (keeps last 7 full, last 14 DB-only)
- Logs backup completion

**When to use:**
- Before major updates
- Scheduled backups (cron job)
- Manual backup before risky operations

**Usage:**
```bash
./scripts/backup.sh           # Hot backup (service keeps running)
./scripts/backup.sh --cold    # Cold backup (stops service)
```

**Backup locations:**
- Full backups: `$HOME/forex-trading-bot-backups/forex_backup_YYYYMMDD_HHMMSS.tar.gz`
- DB backups: `$HOME/forex-trading-bot-backups/trading_YYYYMMDD_HHMMSS.db`

---

### `restore.sh`
**Purpose:** Restore application from a previously created backup.

**What it does:**
- Lists available backups (full and database-only)
- Interactive selection of backup to restore
- Stops PM2 service
- Restores files and/or database
- Reinstalls dependencies
- Rebuilds frontend
- Restarts service
- Verifies health check

**When to use:**
- Disaster recovery
- Rolling back after failed deployment
- Restoring from backup

**Restore types:**
- **Full restore:** Restores entire application (code + data)
- **Database-only:** Restores only the database file

**Safety features:**
- Creates pre-restore backup before overwriting
- Requires explicit confirmation
- Validates backup file integrity

---

## Maintenance & Monitoring Scripts

### `status.sh`
**Purpose:** Comprehensive status dashboard showing system and trading health.

**What it does:**
- Displays system info (hostname, IP, uptime)
- Shows memory and disk usage
- Lists PM2 services status
- Checks API health endpoint
- Displays trading status (enabled/disabled, mode)
- Shows database status and size
- Displays trading statistics (signals, trades, positions)
- Shows account balance and unrealized P/L

**When to use:**
- Quick health check
- Monitoring system status
- Troubleshooting

**Output includes:**
- Color-coded status indicators
- Resource usage metrics
- Trading engine statistics
- Account information

---

### `health-check.sh`
**Purpose:** Automated health check for monitoring systems (cron, external monitors).

**What it does:**
- Checks PM2 process is running
- Tests API health endpoint
- Validates database integrity
- Checks memory usage
- Verifies Oanda connectivity
- Logs results to health.log

**When to use:**
- Cron job monitoring
- External monitoring systems
- Automated alerting

**Exit codes:**
- `0` - All checks passed
- `1` - One or more checks failed

**Log file:** `/opt/forex-trading-bot/backend/logs/health.log`

---

### `logs.sh`
**Purpose:** Quick access to various log sources with filtering options.

**What it does:**
- Provides unified interface to view logs
- Supports multiple log sources (PM2, application, errors)
- Filtering options for trades and errors
- Log clearing functionality

**Usage:**
```bash
./scripts/logs.sh          # Show last 50 PM2 log lines
./scripts/logs.sh tail     # Follow PM2 logs live
./scripts/logs.sh app      # Show application combined.log
./scripts/logs.sh error    # Show error.log
./scripts/logs.sh trades   # Filter for trade-related entries
./scripts/logs.sh errors   # Filter for error entries
./scripts/logs.sh clear    # Clear PM2 logs
```

**When to use:**
- Debugging issues
- Monitoring trade activity
- Checking for errors
- Real-time log monitoring

---

### `update.sh`
**Purpose:** Lightweight update script for quick code pushes without full deployment.

**What it does:**
- Fetches latest changes from git
- Analyzes what changed (backend/frontend/dependencies)
- Conditionally installs dependencies (only if changed)
- Conditionally rebuilds frontend (only if changed)
- Runs database migrations
- Gracefully reloads PM2 service
- Verifies health check

**When to use:**
- Quick code updates
- Small bug fixes
- Configuration changes
- When you don't need full backup/restore cycle

**Key features:**
- Smart change detection (only rebuilds what changed)
- Faster than full `deploy.sh`
- Preserves data (no backup step)
- macOS compatible

**Note:** This script uses `main` branch by default - may need updating for `mac-mini` branch.

---

## Security & Configuration Scripts

### `setup-secrets.sh`
**Purpose:** Interactive setup of encrypted API credentials and secrets.

**What it does:**
- Creates secure directories (`.secrets/` and `.keys/`)
- Generates encryption key if needed
- Prompts for Oanda API credentials:
  - API Key
  - Account ID
  - Environment (live/practice)
- Optionally prompts for email notification credentials
- Encrypts all credentials using AES-256-CBC
- Sets secure file permissions (700/600)

**When to use:**
- First-time setup
- Updating API credentials
- Adding email notifications

**Security features:**
- AES-256-CBC encryption with PBKDF2
- 100,000 iterations
- Secure file permissions
- Encryption key stored separately

**Important:** Back up `$KEYS_DIR/encryption.key` securely! Without it, encrypted secrets cannot be decrypted.

---

### `start-wrapper.sh`
**Purpose:** PM2 wrapper script that decrypts secrets and starts the Node.js server.

**What it does:**
- Reads encryption key from `.keys/encryption.key`
- Decrypts Oanda API credentials
- Decrypts email credentials (if configured)
- Exports credentials as environment variables
- Starts Node.js server (`server.js`)

**When to use:**
- Called automatically by PM2 (via `ecosystem.config.js`)
- Not meant to be run directly

**How it works:**
- PM2 calls this script instead of `node server.js` directly
- Script decrypts secrets and exports them
- Then executes `node server.js` with credentials in environment

**Security:**
- Credentials never stored in plain text
- Decrypted only at runtime
- Environment variables cleared when process stops

---

## Script Summary Table

| Script | Purpose | When to Use | Frequency |
|-------|---------|-------------|-----------|
| `first_time_setup.sh` | Complete installation | First time setup | Once |
| `deploy.sh` | Production deployment | Code updates | As needed |
| `deploy_crypti.sh` | Crypto bot deployment | Crypto bot updates | As needed |
| `deploy-check.sh` | Pre-deployment validation | Before deploying | Before each deploy |
| `backup.sh` | Create backups | Before updates, scheduled | Daily/weekly |
| `restore.sh` | Restore from backup | Disaster recovery | As needed |
| `status.sh` | Status dashboard | Health monitoring | Frequently |
| `health-check.sh` | Automated health check | Monitoring systems | Every 5-15 min |
| `logs.sh` | Log viewer | Debugging, monitoring | As needed |
| `update.sh` | Quick code update | Small changes | Frequently |
| `setup-secrets.sh` | Configure credentials | First setup, credential updates | Rarely |
| `start-wrapper.sh` | PM2 secret decryption | Called by PM2 | Automatic |

---

## Common Workflows

### First-Time Setup
```bash
./scripts/first_time_setup.sh
```

### Regular Deployment
```bash
./scripts/deploy.sh
```

### Quick Update (no backup)
```bash
./scripts/update.sh
```

### Backup Before Major Change
```bash
./scripts/backup.sh --cold
```

### Check Status
```bash
./scripts/status.sh
```

### View Logs
```bash
./scripts/logs.sh tail
```

### Restore from Backup
```bash
./scripts/restore.sh
```

---

## Platform Compatibility

### Mac Mini (macOS)
- ✅ All scripts work
- ✅ No ARM64 Rollup installation needed
- ✅ Uses native group detection (`id -gn`)
- ✅ No swap setup needed

### Raspberry Pi (Linux)
- ⚠️ Some scripts may need ARM64 Rollup installation
- ⚠️ May need swap setup for builds
- ⚠️ Uses `systemctl` for Nginx (not available on macOS)

---

## Notes

- All scripts use colored output for better readability
- Scripts validate prerequisites before running
- Most scripts include error handling and cleanup
- Logs are written to `/opt/forex-trading-bot/backend/logs/`
- Backups are stored in `$HOME/forex-trading-bot-backups/`
- Secrets are encrypted and stored in `/opt/forex-trading-bot/.secrets/`

---

## Troubleshooting

### Script fails with permission errors
- Ensure you're not running as root
- Check sudo access is configured
- Verify file permissions on scripts directory

### Backup/restore fails
- Check disk space available
- Verify backup directory exists and is writable
- Ensure PM2 service is stopped for cold backups

### Health check fails
- Verify PM2 service is running: `pm2 status`
- Check API is responding: `curl http://localhost:3101/api/health`
- Review logs: `./scripts/logs.sh`

### Secrets not decrypting
- Verify encryption key exists: `ls -la /opt/forex-trading-bot/.keys/encryption.key`
- Check file permissions (should be 600)
- Ensure secrets directory exists

---

_Last updated: January 2025_
