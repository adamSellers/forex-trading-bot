jest.mock("nodemailer", () => ({
    createTransport: jest.fn(() => ({ sendMail: jest.fn(async () => ({ messageId: "isolated-mail" })) })),
}));

const nodemailer = require("nodemailer");
const emailService = require("../emailService");

describe("existing trade emails", () => {
    let previousEnv;
    let sendMail;
    const trade = {
        instrument: "AUD_USD", side: "BUY", units: 100,
        entryPrice: 0.66, stopLossPrice: 0.659, takeProfitPrice: 0.662,
        entryType: "fixture", signalStrength: 0.8,
        entryTime: Date.parse("2026-09-07T10:00:00Z"),
        exitTime: Date.parse("2026-09-07T10:05:00Z"),
        exitPrice: 0.661, pnlAud: 0.15, pnlPips: 10, exitReason: "TAKE_PROFIT",
    };

    beforeEach(() => {
        previousEnv = { ...process.env };
        process.env.EMAIL_USER = "sender@example.invalid";
        process.env.EMAIL_PASS = "isolated-test-credential";
        process.env.EMAIL_TO = "owner@example.invalid";
        // The transport is always mocked; these tests cannot send real email.
        emailService.initialize();
        sendMail = nodemailer.createTransport.mock.results.at(-1).value.sendMail;
    });

    afterEach(() => {
        emailService.initialized = false;
        emailService.transporter = null;
        emailService.defaultTo = null;
        process.env = previousEnv;
        jest.clearAllMocks();
    });

    test("trade-open and trade-close notifications still use the existing recipient and content", async () => {
        await emailService.sendTradeOpenedAlert(trade, {
            enableEmailAlerts: true, alertEmail: "custom@example.invalid",
        });
        await emailService.sendTradeClosedAlert(trade, { enableEmailAlerts: true });
        expect(sendMail).toHaveBeenCalledTimes(2);
        expect(sendMail).toHaveBeenNthCalledWith(1, expect.objectContaining({
            to: "custom@example.invalid", subject: "🟢 OPENED: AUD_USD @ 0.66000",
            html: expect.stringContaining("Trade Opened"),
        }));
        expect(sendMail).toHaveBeenNthCalledWith(2, expect.objectContaining({
            to: "owner@example.invalid", subject: "💰 CLOSED: AUD_USD +$0.15 AUD",
            html: expect.stringContaining("TAKE_PROFIT"),
        }));
    });

    test("disabled or unconfigured trade email remains disabled", async () => {
        await emailService.sendTradeOpenedAlert(trade, { enableEmailAlerts: false });
        await emailService.sendTradeClosedAlert(trade, { enableEmailAlerts: false });
        emailService.initialized = false;
        await emailService.sendTradeOpenedAlert(trade, { enableEmailAlerts: true });
        await emailService.sendTradeClosedAlert(trade, { enableEmailAlerts: true });
        expect(sendMail).not.toHaveBeenCalled();
    });
});
