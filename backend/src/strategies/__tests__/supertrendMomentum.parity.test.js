const SignalGenerator = require("../../services/signalGenerator");
const supertrendMomentumStrategy = require("../supertrendMomentum");
const { RSI, ADX, ATR } = require("technicalindicators");
const {
    generateCandles,
    createMockDataService,
} = require("../../../__tests__/fixtures/mockCandles");

describe("supertrendMomentumStrategy parity", () => {
    let generator;

    beforeEach(() => {
        generator = new SignalGenerator({
            minAdx: 22,
            rsiOverbought: 75,
            rsiOversold: 30,
            atrPeriod: 10,
            factor: 3,
            enableContinuationEntry: true,
            continuationWindowMs: 4 * 60 * 60 * 1000,
            continuationRsiThreshold: 70,
            assets: ["AUD_USD"],
        });
        generator.dataService = createMockDataService();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    async function evaluateDirectly(instrument, candles, currentPrice) {
        return supertrendMomentumStrategy.evaluateEntry({
            instrument,
            candles,
            currentPrice,
            config: generator.config,
            dataService: generator.dataService,
            pendingEntry: generator._pendingEntries.get(instrument) || null,
            calculateSuperTrendFn: generator.calculateSuperTrend.bind(generator),
            getHtfTrendContextFn: generator.getHtfTrendContext.bind(generator),
        });
    }

    test("matches live generator output for a fresh long flip", async () => {
        const candles = generateCandles(250);
        const currentPrice = candles[candles.length - 1].close;

        jest.spyOn(generator, "calculateSuperTrend").mockImplementation(() => ({
            superTrend: new Array(candles.length).fill(currentPrice),
            direction: [...new Array(candles.length - 2).fill(-1), -1, 1],
            atr: new Array(candles.length).fill(0.001),
        }));
        jest.spyOn(RSI, "calculate").mockReturnValue([62]);
        jest.spyOn(ATR, "calculate").mockReturnValue([0.001]);
        jest.spyOn(ADX, "calculate").mockReturnValue([
            { adx: 20, pdi: 18, mdi: 12 },
            { adx: 21, pdi: 20, mdi: 12 },
            { adx: 22, pdi: 21, mdi: 11 },
            { adx: 25, pdi: 24, mdi: 10 },
        ]);

        const direct = await evaluateDirectly("AUD_USD", candles, currentPrice);
        expect(direct).toEqual(
            expect.objectContaining({
                signalType: "BUY",
                entryType: "FRESH_FLIP",
                reasonCode: "LONG_FRESH_FLIP_ACTIONABLE",
                signalClass: "ACTIONABLE",
                intent: "ENTER_LONG",
            })
        );
    });

    test("matches live generator output when waiting for HTF confirmation", async () => {
        const m15Candles = generateCandles(250);
        const h1Candles = generateCandles(120, 1.165, "AUD_USD", "down");
        const currentPrice = m15Candles[m15Candles.length - 1].close;

        generator.updateConfig({
            enableHTFFilter: true,
            htfTimeframe: "1h",
        });
        generator.dataService = createMockDataService({
            AUD_USD: m15Candles,
            AUD_USD_1h: h1Candles,
        });

        jest.spyOn(generator, "calculateSuperTrend").mockImplementation((highs) => {
            const isHtf = highs.length === h1Candles.length;
            return {
                superTrend: new Array(highs.length).fill(currentPrice),
                direction: isHtf
                    ? new Array(highs.length).fill(-1)
                    : [...new Array(highs.length - 2).fill(-1), -1, 1],
                atr: new Array(highs.length).fill(0.001),
            };
        });
        jest.spyOn(RSI, "calculate").mockReturnValue([60]);
        jest.spyOn(ATR, "calculate").mockReturnValue([0.001]);
        jest.spyOn(ADX, "calculate").mockReturnValue([
            { adx: 20, pdi: 18, mdi: 12 },
            { adx: 21, pdi: 20, mdi: 12 },
            { adx: 22, pdi: 21, mdi: 11 },
            { adx: 25, pdi: 24, mdi: 10 },
        ]);

        const direct = await evaluateDirectly("AUD_USD", m15Candles, currentPrice);
        expect(direct).toEqual(
            expect.objectContaining({
                signalType: "HOLD",
                reasonCode: "LONG_FRESH_FLIP_WAIT_HTF",
                signalClass: "PENDING",
                intent: "WAIT",
                pendingAction: "set",
                pending: expect.objectContaining({
                    state: "AWAIT_HTF_CONFIRMATION",
                    waitingFor: "HTF_CONFIRMATION",
                    direction: "LONG",
                }),
            })
        );
    });

    test("matches live generator output for long pullback reacceleration", async () => {
        const candles = generateCandles(250);
        const currentPrice = candles[candles.length - 1].close;

        generator._pendingEntries.set("AUD_USD", {
            direction: "LONG",
            state: "AWAIT_REACCELERATION",
            waitingFor: "REACCELERATION",
            flipTime: Date.now() - 45 * 60 * 1000,
            flipPrice: 1.165,
            flipAdx: 25,
            flipRsi: 74,
            peakPrice: 1.17,
            troughPrice: 1.165,
            pullbackLow: 1.1688,
            pullbackHigh: 1.1696,
            pullbackDepthAtr: 1.2,
            reaccelerationTrigger: 1.1696,
        });

        const previous = candles[candles.length - 2];
        const current = candles[candles.length - 1];
        previous.high = 1.1699;
        previous.low = 1.1689;
        previous.close = 1.1691;
        current.open = 1.1692;
        current.low = 1.1691;
        current.high = 1.1708;
        current.close = 1.1702;

        jest.spyOn(generator, "calculateSuperTrend").mockImplementation(() => ({
            superTrend: new Array(candles.length).fill(currentPrice),
            direction: new Array(candles.length).fill(1),
            atr: new Array(candles.length).fill(0.001),
        }));
        jest.spyOn(RSI, "calculate").mockReturnValue([61]);
        jest.spyOn(ATR, "calculate").mockReturnValue([0.001]);
        jest.spyOn(ADX, "calculate").mockReturnValue([
            { adx: 20, pdi: 18, mdi: 12 },
            { adx: 21, pdi: 20, mdi: 12 },
            { adx: 22, pdi: 22, mdi: 11 },
            { adx: 25, pdi: 25, mdi: 10 },
        ]);

        const direct = await evaluateDirectly("AUD_USD", candles, currentPrice);
        expect(direct).toEqual(
            expect.objectContaining({
                signalType: "BUY",
                entryType: "CONTINUATION_PULLBACK",
                reasonCode: "LONG_PULLBACK_REACCELERATION",
                signalClass: "ACTIONABLE",
                intent: "ENTER_LONG",
                pendingAction: "clear",
            })
        );
    });
});
