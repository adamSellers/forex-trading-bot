// backend/src/services/emailService.js - DYNAMIC RECIPIENT SUPPORT
const nodemailer = require("nodemailer");
const logger = require("../utils/logger");

class EmailService {
    constructor() {
        // 1. Configure your Email Provider
        this.transporter = nodemailer.createTransport({
            service: "gmail",
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
        });

        // Default from ENV
        this.defaultTo = process.env.EMAIL_TO || process.env.EMAIL_USER;
        logger.info("📧 Email Service Initialized");
    }

    // UPDATED: Now accepts optional 'dynamicToAddress'
    async sendTradeAlert(trade, dynamicToAddress) {
        if (!process.env.EMAIL_USER) return;

        // Use dynamic address if provided, otherwise default to ENV
        const targetEmail =
            dynamicToAddress && dynamicToAddress.trim() !== ""
                ? dynamicToAddress
                : this.defaultTo;

        if (!targetEmail) {
            logger.warn("⚠️ No email recipient configured. Skipping alert.");
            return;
        }

        const isBuy = trade.side === "BUY";
        const isWin = trade.pnl > 0;

        let subject = "";
        if (isBuy) {
            subject = `🟢 BUY ALERT: ${trade.symbol}`;
        } else {
            const icon = isWin ? "💰" : "🔻";
            subject = `${icon} SELL ALERT: ${trade.symbol} (${
                isWin ? "+" : ""
            }$${trade.pnl?.toFixed(2)})`;
        }

        const html = `
            <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
                <h2 style="color: ${
                    isBuy ? "#2e7d32" : isWin ? "#2e7d32" : "#d32f2f"
                }">
                    ${subject}
                </h2>
                <p><strong>Time:</strong> ${new Date(
                    trade.timestamp
                ).toLocaleString()}</p>
                <hr/>
                <p><strong>Action:</strong> ${trade.side} ${trade.symbol}</p>
                <p><strong>Price:</strong> $${parseFloat(trade.price).toFixed(
                    2
                )}</p>
                <p><strong>Quantity:</strong> ${trade.quantity}</p>
                <p><strong>Total Value:</strong> $${(
                    trade.usdtCost ||
                    trade.usdtReceived ||
                    0
                ).toFixed(2)}</p>
                ${
                    !isBuy
                        ? `<p><strong>PnL:</strong> <span style="font-weight:bold; color:${
                              isWin ? "green" : "red"
                          }">$${trade.pnl?.toFixed(2)}</span></p>`
                        : ""
                }
                ${
                    !isBuy
                        ? `<p><strong>Exit Reason:</strong> ${trade.exitReason}</p>`
                        : ""
                }
                <hr/>
                <p style="font-size: 12px; color: #888;">Sent from V2 Smart Engine 🤖</p>
            </div>
        `;

        try {
            await this.transporter.sendMail({
                from: `"Crypto Bot 🤖" <${process.env.EMAIL_USER}>`,
                to: targetEmail,
                subject: subject,
                html: html,
            });
            logger.info(`📧 Email sent to ${targetEmail}: ${subject}`);
        } catch (error) {
            logger.error("❌ Failed to send email alert:", error);
        }
    }
}

module.exports = new EmailService();
