const EntryDecisionRepository = require("../entryDecisionRepository");

let mockTestDbInstance = null;

jest.mock("../../../config/database", () => ({
    db: new Proxy(function () {}, {
        apply: (target, thisArg, args) => {
            if (mockTestDbInstance) {
                return mockTestDbInstance(args[0]);
            }
            throw new Error("Database not initialized");
        },
        get: (target, prop) => {
            if (mockTestDbInstance && mockTestDbInstance[prop]) {
                return typeof mockTestDbInstance[prop] === "function"
                    ? mockTestDbInstance[prop].bind(mockTestDbInstance)
                    : mockTestDbInstance[prop];
            }
            return undefined;
        },
    }),
}));

describe("EntryDecisionRepository", () => {
    let repository;

    beforeEach(() => {
        repository = new EntryDecisionRepository();
        mockTestDbInstance = null;
    });

    test("should save and map entry decision records", async () => {
        const mockInsert = jest.fn().mockResolvedValue([1]);
        mockTestDbInstance = jest.fn().mockReturnValue({ insert: mockInsert });

        await repository.save({
            decisionId: "decision-1",
            setupId: "setup-1",
            signalCandleTime: 1710000000000,
            decisionTime: 1710000001234,
            instrument: "GBP_USD",
            side: "BUY",
            signal: "BUY",
            entryType: "FRESH_FLIP",
            configHash: "cfg-123",
            configSnapshot: { minAdx: 21, freshLongRsiCeiling: 68 },
            stage: "RECEIVED",
            outcome: "PENDING",
            spreadPips: 1.2,
            priceAgeMs: 150,
            openPositions: 1,
            projectedExposure: 0.42,
            signalStrength: 28.5,
            adx: 28.5,
            rsi: 64.2,
            atrPips: 13.4,
            timesFmContext: {
                available: true,
                direction: "BULLISH",
                confidence: 0.79,
            },
            runId: "run-live-1",
            selectionId: "selection-1",
            mode: "live",
            strategy: "supertrend_momentum",
        });

        expect(mockInsert).toHaveBeenCalledWith(
            expect.objectContaining({
                decision_id: "decision-1",
                setup_id: "setup-1",
                signal_candle_time: 1710000000000,
                decision_time: 1710000001234,
                instrument: "GBP_USD",
                side: "BUY",
                signal: "BUY",
                entry_type: "FRESH_FLIP",
                config_hash: "cfg-123",
                stage: "RECEIVED",
                outcome: "PENDING",
                spread_pips: 1.2,
                price_age_ms: 150,
                open_positions: 1,
                projected_exposure: 0.42,
                signal_strength: 28.5,
                adx: 28.5,
                rsi: 64.2,
                atr_pips: 13.4,
                run_id: "run-live-1",
                selection_id: "selection-1",
                mode: "live",
                strategy: "supertrend_momentum",
            })
        );
        expect(mockInsert.mock.calls[0][0].timesfm_context).toBe(
            JSON.stringify({
                available: true,
                direction: "BULLISH",
                confidence: 0.79,
            })
        );
        expect(mockInsert.mock.calls[0][0].config_snapshot).toBe(
            JSON.stringify({
                minAdx: 21,
                freshLongRsiCeiling: 68,
            })
        );
    });

    test("should update stage, outcome, rejection code, and trade link", async () => {
        const mockUpdate = jest.fn().mockResolvedValue(1);
        const mockWhere = jest.fn().mockReturnValue({ update: mockUpdate });
        mockTestDbInstance = jest.fn().mockReturnValue({ where: mockWhere });

        await repository.updateDecision("decision-2", {
            stage: "FILLED",
            outcome: "FILLED",
            tradeId: "trade-2",
            runId: "run-live-2",
            selectionId: "selection-2",
            strategy: "supertrend_momentum",
            timesFmContext: {
                available: false,
                reason: "sidecar_unavailable",
            },
            rejectionCode: null,
            rejectionReason: null,
        });

        expect(mockWhere).toHaveBeenCalledWith("decision_id", "decision-2");
        expect(mockUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                stage: "FILLED",
                outcome: "FILLED",
                trade_id: "trade-2",
                run_id: "run-live-2",
                selection_id: "selection-2",
                strategy: "supertrend_momentum",
                rejection_code: null,
                rejection_reason: null,
            })
        );
        expect(mockUpdate.mock.calls[0][0].timesfm_context).toBe(
            JSON.stringify({
                available: false,
                reason: "sidecar_unavailable",
            })
        );
    });

    test("should return decisions since cutoff", async () => {
        const rows = [
            {
                id: 2,
                decision_id: "decision-new",
                decision_time: 1710000100000,
                instrument: "AUD_USD",
                side: "BUY",
                signal: "BUY",
                entry_type: null,
                config_hash: null,
                config_snapshot: null,
                outcome: "PENDING",
                stage: "RECEIVED",
                rejection_code: null,
                rejection_reason: null,
                spread_pips: null,
                price_age_ms: null,
                open_positions: null,
                projected_exposure: null,
                signal_strength: null,
                adx: null,
                rsi: null,
                atr_pips: null,
                trade_id: null,
                run_id: null,
                selection_id: null,
                mode: "live",
                strategy: null,
                timesfm_context: JSON.stringify({
                    available: true,
                    direction: "BULLISH",
                }),
                created_at: new Date(),
                updated_at: new Date(),
            },
        ];
        const mockOrderBy = jest.fn().mockResolvedValue(rows);
        const query = {
            orderBy: mockOrderBy,
        };
        const mockWhere = jest.fn().mockReturnValue(query);
        mockTestDbInstance = jest.fn().mockReturnValue({ where: mockWhere });

        const result = await repository.getDecisionsSince(1710000050000);
        expect(mockWhere).toHaveBeenCalledWith(
            "decision_time",
            ">=",
            1710000050000
        );
        expect(mockOrderBy).toHaveBeenCalledWith("decision_time", "desc");
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual(
            expect.objectContaining({
                decisionId: "decision-new",
                decisionTime: 1710000100000,
                instrument: "AUD_USD",
                timesFmContext: {
                    available: true,
                    direction: "BULLISH",
                },
            })
        );
    });
});
