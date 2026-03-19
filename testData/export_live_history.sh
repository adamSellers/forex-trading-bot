#!/usr/bin/env bash
set -euo pipefail

DEFAULT_HOST="${FOREX_BOT_HOST:-adam@img.oakroad}"
DEFAULT_DB_PATH="${FOREX_BOT_DB_PATH:-/opt/forex-trading-bot/backend/data/trading.db}"

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "Missing required command: $1" >&2
        exit 1
    fi
}

usage() {
    cat <<EOF
Usage: $(basename "$0") [days]

Exports live trade and signal CSVs from the production bot.

Environment overrides:
  FOREX_BOT_HOST     SSH host or host alias (default: $DEFAULT_HOST)
  FOREX_BOT_DB_PATH  Remote SQLite path (default: $DEFAULT_DB_PATH)
EOF
}

prompt_days() {
    local response="${1:-}"

    if [[ -n "$response" ]]; then
        printf '%s\n' "$response"
        return 0
    fi

    read -r -p "How many days of history do you want to export? [7]: " response
    response="${response:-7}"
    printf '%s\n' "$response"
}

main() {
    local days="${1:-}"
    local host="$DEFAULT_HOST"
    local db_path="$DEFAULT_DB_PATH"
    local output_dir
    local stamp
    local prefix
    local remote_tmp=""
    local tarball_name

    if [[ "${days:-}" == "-h" || "${days:-}" == "--help" ]]; then
        usage
        exit 0
    fi

    require_command ssh
    require_command scp
    require_command tar

    days="$(prompt_days "$days")"

    if ! [[ "$days" =~ ^[1-9][0-9]*$ ]]; then
        echo "Days must be a positive whole number." >&2
        exit 1
    fi

    output_dir="$(pwd)"
    if [[ ! -w "$output_dir" ]]; then
        echo "Output directory is not writable: $output_dir" >&2
        exit 1
    fi

    stamp="$(date -u +%Y%m%d_%H%M%S)"
    prefix="forex_history_${days}d_${stamp}"
    tarball_name="${prefix}.tar.gz"

    cleanup_remote() {
        if [[ -n "$remote_tmp" ]]; then
            ssh "$host" "rm -rf '$remote_tmp'" >/dev/null 2>&1 || true
        fi
    }

    trap cleanup_remote EXIT

    echo "Connecting to $host"
    remote_tmp="$(ssh "$host" "mktemp -d /tmp/forex-history-export.XXXXXX")"

    echo "Building CSV exports on the bot"
    ssh "$host" bash -s -- "$days" "$db_path" "$remote_tmp" "$prefix" <<'REMOTE'
set -euo pipefail

days="$1"
db_path="$2"
remote_tmp="$3"
prefix="$4"

if ! command -v sqlite3 >/dev/null 2>&1; then
    echo "sqlite3 is required on the remote host." >&2
    exit 1
fi

if ! command -v tar >/dev/null 2>&1; then
    echo "tar is required on the remote host." >&2
    exit 1
fi

if [[ ! -f "$db_path" ]]; then
    echo "Database not found on remote host: $db_path" >&2
    exit 1
fi

snapshot="$remote_tmp/trading_snapshot.db"
sqlite3 "$db_path" ".backup '$snapshot'"

sqlite3 -header -csv "$snapshot" <<SQL > "$remote_tmp/${prefix}_trades.csv"
SELECT trade_id, oanda_trade_id, instrument, side, signal,
       COALESCE(entry_type,'UNKNOWN') AS entry_type, signal_strength, atr_pips, spread_pips,
       units, entry_price, exit_price, stop_loss_price, take_profit_price, trailing_stop_price,
       margin_used_aud, pnl_aud, pnl_pips, pnl_percent, swap_aud, commission_aud,
       holding_period_ms, entry_time, datetime(entry_time/1000,'unixepoch') AS entry_utc,
       exit_time, datetime(exit_time/1000,'unixepoch') AS exit_utc, exit_reason
FROM trades
WHERE mode='live' AND is_open=0
  AND exit_time >= (strftime('%s','now','-${days} days') * 1000)
ORDER BY exit_time ASC;
SQL

sqlite3 -header -csv "$snapshot" <<SQL > "$remote_tmp/${prefix}_trade_entries.csv"
SELECT trade_id, oanda_trade_id, instrument, side, signal,
       COALESCE(entry_type,'UNKNOWN') AS entry_type, signal_strength, atr_pips, spread_pips,
       units, entry_price, stop_loss_price, take_profit_price, trailing_stop_price,
       margin_used_aud, entry_time, datetime(entry_time/1000,'unixepoch') AS entry_utc,
       is_open, exit_time, datetime(exit_time/1000,'unixepoch') AS exit_utc, exit_reason,
       pnl_aud, pnl_pips, pnl_percent
FROM trades
WHERE mode='live'
  AND entry_time >= (strftime('%s','now','-${days} days') * 1000)
ORDER BY entry_time ASC;
SQL

sqlite3 -header -csv "$snapshot" <<SQL > "$remote_tmp/${prefix}_trade_summary.csv"
SELECT instrument, side, COALESCE(entry_type,'UNKNOWN') AS entry_type,
       COUNT(*) AS trades,
       ROUND(100.0 * SUM(CASE WHEN pnl_aud > 0 THEN 1 ELSE 0 END) / COUNT(*), 1) AS win_rate_pct,
       ROUND(SUM(COALESCE(pnl_aud,0)), 2) AS total_pnl_aud,
       ROUND(AVG(COALESCE(pnl_aud,0)), 2) AS avg_pnl_aud,
       ROUND(AVG(COALESCE(pnl_pips,0)), 1) AS avg_pnl_pips,
       ROUND(AVG(CASE WHEN pnl_aud > 0 THEN pnl_aud END), 2) AS avg_win_aud,
       ROUND(ABS(AVG(CASE WHEN pnl_aud < 0 THEN pnl_aud END)), 2) AS avg_loss_aud,
       ROUND(
           ABS(SUM(CASE WHEN pnl_aud > 0 THEN pnl_aud ELSE 0 END)) /
           NULLIF(ABS(SUM(CASE WHEN pnl_aud < 0 THEN pnl_aud ELSE 0 END)), 0),
           2
       ) AS profit_factor
FROM trades
WHERE mode='live' AND is_open=0
  AND exit_time >= (strftime('%s','now','-${days} days') * 1000)
GROUP BY instrument, side, COALESCE(entry_type,'UNKNOWN')
ORDER BY total_pnl_aud DESC;
SQL

sqlite3 -header -csv "$snapshot" <<SQL > "$remote_tmp/${prefix}_signals.csv"
SELECT instrument, signal, COALESCE(entry_type,'UNKNOWN') AS entry_type,
       strength, adx, rsi, atr_pips, price, supertrend_direction, timeframe,
       REPLACE(REPLACE(COALESCE(message,''), char(10), ' '), char(13), ' ') AS message,
       timestamp, datetime(timestamp/1000,'unixepoch') AS signal_utc
FROM signals
WHERE timestamp >= (strftime('%s','now','-${days} days') * 1000)
ORDER BY timestamp ASC;
SQL

sqlite3 -header -csv "$snapshot" <<SQL > "$remote_tmp/${prefix}_signals_actionable.csv"
SELECT instrument, signal, COALESCE(entry_type,'UNKNOWN') AS entry_type,
       strength, adx, rsi, atr_pips, price, supertrend_direction, timeframe,
       REPLACE(REPLACE(COALESCE(message,''), char(10), ' '), char(13), ' ') AS message,
       timestamp, datetime(timestamp/1000,'unixepoch') AS signal_utc
FROM signals
WHERE timestamp >= (strftime('%s','now','-${days} days') * 1000)
  AND signal <> 'HOLD'
ORDER BY timestamp ASC;
SQL

tar -czf "$remote_tmp/${prefix}.tar.gz" -C "$remote_tmp" \
    "${prefix}_trades.csv" \
    "${prefix}_trade_entries.csv" \
    "${prefix}_trade_summary.csv" \
    "${prefix}_signals.csv" \
    "${prefix}_signals_actionable.csv"
REMOTE

    echo "Copying CSVs into $output_dir"
    scp "$host:$remote_tmp/$tarball_name" "$output_dir/$tarball_name" >/dev/null
    tar -xzf "$output_dir/$tarball_name" -C "$output_dir"
    rm -f "$output_dir/$tarball_name"

    echo "Export complete. Files written to $output_dir"
    printf '  %s\n' \
        "$output_dir/${prefix}_trades.csv" \
        "$output_dir/${prefix}_trade_entries.csv" \
        "$output_dir/${prefix}_trade_summary.csv" \
        "$output_dir/${prefix}_signals.csv" \
        "$output_dir/${prefix}_signals_actionable.csv"
}

main "$@"
