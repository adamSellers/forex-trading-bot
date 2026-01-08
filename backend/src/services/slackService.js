// backend/src/services/slackService.js - Slack Notification Service
const logger = require("../utils/logger");

class SlackService {
    constructor() {
        this.webhookUrl = process.env.SLACK_WEBHOOK_URL;
        this.isEnabled = !!this.webhookUrl;

        if (this.isEnabled) {
            logger.info("💬 Slack Service Initialized");
        } else {
            logger.info("💬 Slack Service disabled (no webhook URL configured)");
        }
    }

    /**
     * Send a trade alert to Slack
     * @param {Object} trade - Trade object with trade details
     * @param {string} eventType - 'opened' or 'closed'
     */
    async sendTradeAlert(trade, eventType = "opened") {
        if (!this.isEnabled) {
            return;
        }

        const isBuy = trade.side === "BUY";
        const isOpen = eventType === "opened";
        const isWin = trade.pnlAud > 0;
        const isLoss = trade.pnlAud < 0;

        // Determine color and emoji based on trade status
        let color = "#36a64f"; // Green for buy/open
        let emoji = "🟢";
        let statusText = "";

        if (!isOpen) {
            // Trade closed
            if (isWin) {
                color = "#2e7d32"; // Dark green for profit
                emoji = "💰";
                statusText = `Profit: +$${Math.abs(trade.pnlAud).toFixed(2)}`;
            } else if (isLoss) {
                color = "#d32f2f"; // Red for loss
                emoji = "🔻";
                statusText = `Loss: -$${Math.abs(trade.pnlAud).toFixed(2)}`;
            } else {
                color = "#757575"; // Gray for breakeven
                emoji = "➖";
                statusText = "Breakeven";
            }
        }

        // Format trade details
        const title = isOpen
            ? `${emoji} Trade Opened: ${trade.instrument}`
            : `${emoji} Trade Closed: ${trade.instrument}`;

        const fields = [
            {
                title: "Action",
                value: `${trade.side} ${trade.instrument}`,
                short: true,
            },
            {
                title: "Entry Price",
                value: `$${parseFloat(trade.entryPrice).toFixed(5)}`,
                short: true,
            },
            {
                title: "Units",
                value: trade.units.toLocaleString(),
                short: true,
            },
            {
                title: "Stop Loss",
                value: `$${parseFloat(trade.stopLossPrice || 0).toFixed(5)}`,
                short: true,
            },
        ];

        if (!isOpen) {
            fields.push(
                {
                    title: "Exit Price",
                    value: `$${parseFloat(trade.exitPrice || 0).toFixed(5)}`,
                    short: true,
                },
                {
                    title: "P&L",
                    value: `$${trade.pnlAud?.toFixed(2) || "0.00"}`,
                    short: true,
                },
                {
                    title: "P&L (Pips)",
                    value: `${trade.pnlPips?.toFixed(1) || "0.0"} pips`,
                    short: true,
                },
                {
                    title: "Exit Reason",
                    value: trade.exitReason || "Manual",
                    short: true,
                }
            );
        }

        // Add holding period for closed trades
        if (!isOpen && trade.holdingPeriodMs) {
            const hours = Math.floor(trade.holdingPeriodMs / (1000 * 60 * 60));
            const minutes = Math.floor(
                (trade.holdingPeriodMs % (1000 * 60 * 60)) / (1000 * 60)
            );
            fields.push({
                title: "Holding Period",
                value: `${hours}h ${minutes}m`,
                short: true,
            });
        }

        const slackPayload = {
            username: "Forex Trading Bot",
            icon_emoji: ":chart_with_upwards_trend:",
            attachments: [
                {
                    color: color,
                    title: title,
                    fields: fields,
                    footer: "Forex Trading Bot",
                    ts: Math.floor(
                        (isOpen ? trade.entryTime : trade.exitTime || Date.now()) /
                            1000
                    ),
                },
            ],
        };

        if (statusText) {
            slackPayload.attachments[0].text = statusText;
        }

        try {
            const response = await fetch(this.webhookUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(slackPayload),
            });

            if (!response.ok) {
                const errorText = await response.text();
                logger.error(
                    `❌ Failed to send Slack notification: ${response.status} - ${errorText}`
                );
            } else {
                logger.info(
                    `💬 Slack notification sent: ${title}`
                );
            }
        } catch (error) {
            logger.error("❌ Failed to send Slack alert:", error.message);
        }
    }

    /**
     * Send a custom message to Slack
     * @param {string} message - Message text
     * @param {string} color - Attachment color (optional)
     */
    async sendMessage(message, color = "#36a64f") {
        if (!this.isEnabled) {
            return;
        }

        const slackPayload = {
            username: "Forex Trading Bot",
            icon_emoji: ":chart_with_upwards_trend:",
            attachments: [
                {
                    color: color,
                    text: message,
                    footer: "Forex Trading Bot",
                    ts: Math.floor(Date.now() / 1000),
                },
            ],
        };

        try {
            const response = await fetch(this.webhookUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(slackPayload),
            });

            if (!response.ok) {
                const errorText = await response.text();
                logger.error(
                    `❌ Failed to send Slack message: ${response.status} - ${errorText}`
                );
            }
        } catch (error) {
            logger.error("❌ Failed to send Slack message:", error.message);
        }
    }
}

module.exports = new SlackService();
