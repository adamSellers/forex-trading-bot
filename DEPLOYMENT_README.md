# Forex Trading Bot - Deployment Scripts

## Overview

These scripts manage the forex trading bot deployment on Raspberry Pi 5 (8GB).

**Port Allocation:**
| Service | Port |
|---------|------|
| Forex Backend | 3101 |
| Forex Frontend | 3100 |
| Crypto Backend | 3001 |
| Crypto Frontend | 3000 |

---

## Scripts Included

### Core Deployment

| Script                | Purpose             | When to Use               |
| --------------------- | ------------------- | ------------------------- |
| `first_time_setup.sh` | Fresh installation  | First deployment only     |
| `deploy.sh`           | Standard deployment | Feature updates, hotfixes |
| `update.sh`           | Quick code sync     | Minor changes only        |

### Operations

| Script            | Purpose                   |
| ----------------- | ------------------------- |
| `backup.sh`       | Create timestamped backup |
| `restore.sh`      | Restore from backup       |
| `status.sh`       | System dashboard          |
| `health-check.sh` | Service health (for cron) |
| `logs.sh`         | Quick log access          |

### Security

| Script             | Purpose                                     |
| ------------------ | ------------------------------------------- |
| `setup-secrets.sh` | Encrypt Oanda API credentials               |
| `start-wrapper.sh` | Decrypt and inject secrets (PM2 calls this) |

---

## First Time Setup

SSH into your Pi and run:

```bash
# 1. Download the setup script (or clone repo first)
curl -O https://raw.githubusercontent.com/adamSellers/forex-trading-bot/main/scripts/first_time_setup.sh
chmod +x first_time_setup.sh

# 2. Run setup
./first_time_setup.sh
```

This will:

1. Clone the repository to `/opt/forex-trading-bot`
2. Install dependencies (backend + frontend)
3. Build the frontend
4. Run database migrations
5. Prompt for Oanda API credentials (encrypted)
6. Start the service via PM2

---

## Subsequent Deployments

For code updates after initial setup:

```bash
cd /opt/forex-trading-bot
./scripts/deploy.sh
```

For quick updates (no frontend rebuild):

```bash
cd /opt/forex-trading-bot
./scripts/update.sh
```

---

## Daily Operations

### Check Status

```bash
./scripts/status.sh
# or
pm2 status
```

### View Logs

```bash
./scripts/logs.sh          # Last 50 lines
./scripts/logs.sh tail     # Follow live
./scripts/logs.sh trades   # Filter trade activity
./scripts/logs.sh errors   # Filter errors
```

### Manual Backup

```bash
./scripts/backup.sh        # Hot backup (service running)
./scripts/backup.sh --cold # Cold backup (stops service)
```

### Restore from Backup

```bash
./scripts/restore.sh
# Interactive menu to select backup
```

---

## Automated Health Checks (Cron)

Add to crontab (`crontab -e`):

```cron
# Health check every 5 minutes
*/5 * * * * /opt/forex-trading-bot/scripts/health-check.sh >> /opt/forex-trading-bot/backend/logs/cron.log 2>&1

# Daily backup at 2 AM
0 2 * * * /opt/forex-trading-bot/scripts/backup.sh >> /home/adam/forex-trading-bot-backups/backup.log 2>&1
```

---

## Oanda Credentials

Credentials are stored encrypted in:

-   `/opt/forex-trading-bot/.secrets/oanda_api_key.enc`
-   `/opt/forex-trading-bot/.secrets/oanda_account_id.enc`

To update credentials:

```bash
./scripts/setup-secrets.sh
pm2 restart forex-backend
```

---

## Troubleshooting

### Service won't start

```bash
pm2 logs forex-backend --lines 50
# Check for missing dependencies or config errors
```

### API not responding

```bash
curl http://localhost:3101/api/health
./scripts/health-check.sh
```

### Database issues

```bash
sqlite3 /opt/forex-trading-bot/backend/data/trading.db ".tables"
sqlite3 /opt/forex-trading-bot/backend/data/trading.db "SELECT COUNT(*) FROM trades;"
```

### Oanda connection errors

```bash
# Verify credentials are set
cat /opt/forex-trading-bot/.secrets/oanda_api_key.enc
# (should show encrypted binary data)

# Test decryption manually
./scripts/start-wrapper.sh
# Should show "Secrets decrypted and loaded"
```

### Full reset (nuclear option)

```bash
pm2 delete forex-backend
sudo rm -rf /opt/forex-trading-bot
./first_time_setup.sh
```

---

## Files NOT Needed (Removed from Crypto Bot)

These scripts were specific to the crypto bot and have been removed:

-   `clean-install.sh` - Redundant with `first_time_setup.sh`
-   `deploy_crypti.sh` - Crypto-specific deploy
-   `deploy-check.sh` - Crypto-specific validation
-   `dev-setup.sh` - Different development environment
-   `rollback.sh` - Replaced by `restore.sh`
-   `monitor.sh` - Merged into `status.sh`
-   `collect_logs.sh` - Crypto-specific paths

---

## Quick Reference

```bash
# Start/Stop
pm2 start forex-backend
pm2 stop forex-backend
pm2 restart forex-backend

# Logs
pm2 logs forex-backend
pm2 logs forex-backend --lines 100 --nostream

# Status
pm2 status
pm2 monit

# Both bots
pm2 status
pm2 restart all
```
