// backend/src/services/emailService.js - Forex Trading Bot Email Alerts
const nodemailer = require("nodemailer");
const logger = require("../utils/logger");

class EmailService {
    constructor() {
        this.transporter = null;
        this.defaultTo = null;
        this.initialized = false;
    }

    /**
     * Initialize email transporter (called when email credentials are available)
     */
    initialize() {
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
            logger.info("📧 Email Service: No credentials configured (alerts disabled)");
            return false;
        }

        this.transporter = nodemailer.createTransport({
            service: "gmail",
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 20000,
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
        });

        this.defaultTo = process.env.EMAIL_TO || process.env.EMAIL_USER;
        this.initialized = true;
        logger.info("📧 Email Service initialized");
        return true;
    }

    /**
     * Check if email alerts are enabled and configured
     */
    isEnabled(config) {
        return (
            this.initialized &&
            config?.enableEmailAlerts === true &&
            (config?.alertEmail || this.defaultTo)
        );
    }

    /**
     * Send trade opened alert
     * @param {object} trade - Trade object from LiveTradingEngine
     * @param {object} config - Trading config
     */
    async sendTradeOpenedAlert(trade, config) {
        if (!this.isEnabled(config)) return;

        const targetEmail = config.alertEmail?.trim() || this.defaultTo;

        const subject = `🟢 OPENED: ${trade.instrument} @ ${trade.entryPrice.toFixed(5)}`;

        const tpInfo = trade.takeProfitPrice
            ? `<p><strong>Take Profit:</strong> ${trade.takeProfitPrice.toFixed(5)}</p>`
            : "";

        const html = `
            <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #2e7d32; border-radius: 8px; max-width: 400px;">
                <h2 style="color: #2e7d32; margin-top: 0;">
                    🟢 Trade Opened
                </h2>
                <hr style="border: none; border-top: 1px solid #ddd;"/>
                <p><strong>Pair:</strong> ${trade.instrument}</p>
                <p><strong>Direction:</strong> ${trade.side || "BUY"}</p>
                <p><strong>Units:</strong> ${trade.units.toLocaleString()}</p>
                <p><strong>Entry Price:</strong> ${trade.entryPrice.toFixed(5)}</p>
                <p><strong>Stop Loss:</strong> ${trade.stopLossPrice.toFixed(5)}</p>
                ${tpInfo}
                <p><strong>Signal:</strong> ${trade.entryType || trade.signal}</p>
                <p><strong>Strength:</strong> ${(trade.signalStrength * 100).toFixed(0)}%</p>
                <hr style="border: none; border-top: 1px solid #ddd;"/>
                <p style="font-size: 12px; color: #888;">
                    ${new Date(trade.entryTime).toLocaleString("en-AU", { timeZone: "Australia/Sydney" })} AEDT
                </p>
                <p style="font-size: 11px; color: #aaa;">Forex Trading Bot</p>
            </div>
        `;

        await this._send(targetEmail, subject, html);
    }

    /**
     * Send trade closed alert
     * @param {object} trade - Closed trade object
     * @param {object} config - Trading config
     */
    async sendTradeClosedAlert(trade, config) {
        if (!this.isEnabled(config)) return;

        const targetEmail = config.alertEmail?.trim() || this.defaultTo;
        const isWin = trade.pnlAud > 0;
        const icon = isWin ? "💰" : "🔻";
        const color = isWin ? "#2e7d32" : "#d32f2f";
        const pnlSign = isWin ? "+" : "";

        const subject = `${icon} CLOSED: ${trade.instrument} ${pnlSign}$${trade.pnlAud.toFixed(2)} AUD`;

        // Calculate hold time
        const holdMs = trade.holdingPeriodMs || (trade.exitTime - trade.entryTime);
        const holdMins = Math.round(holdMs / 60000);
        const holdTime = holdMins >= 60
            ? `${Math.floor(holdMins / 60)}h ${holdMins % 60}m`
            : `${holdMins}m`;

        const html = `
            <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid ${color}; border-radius: 8px; max-width: 400px;">
                <h2 style="color: ${color}; margin-top: 0;">
                    ${icon} Trade Closed
                </h2>
                <hr style="border: none; border-top: 1px solid #ddd;"/>
                <p><strong>Pair:</strong> ${trade.instrument}</p>
                <p><strong>Entry:</strong> ${trade.entryPrice.toFixed(5)}</p>
                <p><strong>Exit:</strong> ${trade.exitPrice.toFixed(5)}</p>
                <p><strong>Units:</strong> ${trade.units.toLocaleString()}</p>
                <hr style="border: none; border-top: 1px solid #ddd;"/>
                <p style="font-size: 18px; font-weight: bold; color: ${color};">
                    P/L: ${pnlSign}$${trade.pnlAud.toFixed(2)} AUD (${pnlSign}${trade.pnlPips?.toFixed(1) || "?"} pips)
                </p>
                ${trade.swapAud ? `<p><strong>Swap:</strong> $${trade.swapAud.toFixed(2)}</p>` : ""}
                <p><strong>Exit Reason:</strong> ${trade.exitReason}</p>
                <p><strong>Hold Time:</strong> ${holdTime}</p>
                <hr style="border: none; border-top: 1px solid #ddd;"/>
                <p style="font-size: 12px; color: #888;">
                    ${new Date(trade.exitTime).toLocaleString("en-AU", { timeZone: "Australia/Sydney" })} AEDT
                </p>
                <p style="font-size: 11px; color: #aaa;">Forex Trading Bot</p>
            </div>
        `;

        await this._send(targetEmail, subject, html);
    }

    /**
     * Send a test email
     */
    async sendTestEmail(toAddress) {
        if (!this.initialized) {
            throw new Error("Email service not initialized - check EMAIL_USER and EMAIL_PASS");
        }

        const subject = "🧪 Forex Bot Email Test";
        const html = `
            <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #1976d2; border-radius: 8px; max-width: 400px;">
                <h2 style="color: #1976d2; margin-top: 0;">
                    🧪 Test Email
                </h2>
                <p>Email alerts are working correctly!</p>
                <p>You will receive notifications when trades are opened or closed.</p>
                <hr style="border: none; border-top: 1px solid #ddd;"/>
                <p style="font-size: 12px; color: #888;">
                    ${new Date().toLocaleString("en-AU", { timeZone: "Australia/Sydney" })} AEDT
                </p>
                <p style="font-size: 11px; color: #aaa;">Forex Trading Bot</p>
            </div>
        `;

        await this._send(toAddress || this.defaultTo, subject, html);
        return true;
    }

    async sendOperationalHealthAlert({ snapshot, newIssues = [], recoveredIssues = [] }, config) {
        if (!this.isEnabled(config)) return false;
        const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g,
            (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
        const rows = (issues) => issues.map((issue) => `<li>${escapeHtml(issue.message)}</li>`).join("");
        const subject = newIssues.length ? "Forex bot: operational attention required" : "Forex bot: operational recovery";
        const html = `<div style="font-family:Arial,sans-serif;max-width:600px">
            <h2>${subject}</h2>
            ${newIssues.length ? `<p>New issues:</p><ul>${rows(newIssues)}</ul>` : ""}
            ${recoveredIssues.length ? `<p>Recovered:</p><ul>${rows(recoveredIssues)}</ul>` : ""}
            <p>Current operational state: ${escapeHtml(snapshot.status)}.</p>
            <p>Check the dashboard before resuming entries after an incident.</p>
            <p>${escapeHtml(new Date(snapshot.checkedAt).toISOString())}</p>
        </div>`;
        return this._send(config.alertEmail?.trim() || this.defaultTo, subject, html);
    }

    /**
     * Internal send method
     */
    async _send(to, subject, html) {
        if (!this.transporter || !to) {
            return false;
        }

        try {
            await this.transporter.sendMail({
                from: `"Forex Bot" <${process.env.EMAIL_USER}>`,
                to,
                subject,
                html,
            });
            logger.info(`📧 Email sent to ${to}: ${subject}`);
            return true;
        } catch (error) {
            logger.error(`❌ Failed to send email: ${error.message}`);
            return false;
        }
    }
}

module.exports = new EmailService();
