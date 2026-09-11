const { createEngineSupervisor } = require("../engineSupervisor");

function createLogger() {
    return {
        success: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
    };
}

function createHarness(engineOverrides = {}, supervisorOverrides = {}) {
    const timers = [];
    const engine = {
        isRunning: false,
        start: jest.fn(async () => {
            engine.isRunning = true;
        }),
        startMonitoring: jest.fn(),
        ...engineOverrides,
    };
    const logger = createLogger();
    const onStatusChange = jest.fn();

    const supervisor = createEngineSupervisor({
        tradingEngine: engine,
        onStatusChange,
        logger,
        minRetryMs: 1000,
        maxRetryMs: 4000,
        setTimeoutFn: (fn, delayMs) => {
            const timer = { fn, delayMs, cleared: false, unref: () => timer };
            timers.push(timer);
            return timer;
        },
        clearTimeoutFn: (timer) => {
            if (timer) timer.cleared = true;
        },
        ...supervisorOverrides,
    });

    // Run the most recently scheduled retry timer.
    const fireLastTimer = async () => {
        const timer = timers[timers.length - 1];
        await timer.fn();
    };

    return { supervisor, engine, logger, onStatusChange, timers, fireLastTimer };
}

describe("engineSupervisor", () => {
    test("starts the engine and enables position monitoring", async () => {
        const { supervisor, engine, onStatusChange } = createHarness();

        const result = await supervisor.ensureStarted({ reason: "boot" });

        expect(result).toEqual({ running: true });
        expect(engine.start).toHaveBeenCalledTimes(1);
        expect(engine.startMonitoring).toHaveBeenCalledTimes(1);
        expect(onStatusChange).toHaveBeenCalled();
    });

    test("initializes ownership and attaches management before starting scans", async () => {
        const sequence = [];
        const beforeStart = jest.fn(async () => sequence.push("ownership"));
        const onStarted = jest.fn(async () => sequence.push("scan"));
        const { supervisor, engine } = createHarness({
            start: jest.fn(async () => { sequence.push("attach"); engine.isRunning = true; }),
            startMonitoring: jest.fn(() => sequence.push("monitor")),
        }, { beforeStart, onStarted });
        await supervisor.ensureStarted();
        expect(sequence).toEqual(["ownership", "attach", "monitor", "scan"]);
    });

    test("starts scans when a delayed attachment retry succeeds", async () => {
        const beforeStart = jest.fn();
        const onStarted = jest.fn();
        const { supervisor, engine, fireLastTimer } = createHarness({}, { beforeStart, onStarted });
        engine.start.mockRejectedValueOnce(new Error("Broker unavailable"));
        await supervisor.ensureStarted();
        expect(onStarted).not.toHaveBeenCalled();
        await fireLastTimer();
        expect(onStarted).toHaveBeenCalledTimes(1);
        expect(beforeStart).toHaveBeenCalledTimes(2);
        expect(engine.startMonitoring).toHaveBeenCalledTimes(1);
    });

    test("retries failed signal startup without detaching or duplicating management", async () => {
        const beforeStart = jest.fn();
        const onStarted = jest.fn().mockRejectedValueOnce(new Error("Signal history unavailable"))
            .mockResolvedValue(undefined);
        const { supervisor, engine, fireLastTimer } = createHarness({}, { beforeStart, onStarted });
        await expect(supervisor.ensureStarted()).resolves.toMatchObject({
            running: true, error: "Signal history unavailable", retryInMs: 1000,
        });
        expect(engine.isRunning).toBe(true);
        expect(engine.startMonitoring).toHaveBeenCalledTimes(1);
        await fireLastTimer();
        expect(engine.start).toHaveBeenCalledTimes(1);
        expect(beforeStart).toHaveBeenCalledTimes(1);
        expect(onStarted).toHaveBeenCalledTimes(2);
        expect(supervisor.isRetryScheduled()).toBe(false);
    });

    test("is a no-op when the engine is already attached", async () => {
        const { supervisor, engine } = createHarness({ isRunning: true });

        const result = await supervisor.ensureStarted();

        expect(result).toEqual({ running: true, alreadyRunning: true });
        expect(engine.start).not.toHaveBeenCalled();
    });

    // The 2026-07-23 outage: Oanda was unreachable at boot, start() threw
    // before subscribing to signals, and nothing ever tried again.
    test("schedules a retry instead of giving up when the broker is unreachable", async () => {
        const { supervisor, timers } = createHarness({
            start: jest.fn(async () => {
                throw new Error("Oanda request failed: fetch failed");
            }),
        });

        const result = await supervisor.ensureStarted({ reason: "boot" });

        expect(result).toEqual(
            expect.objectContaining({
                running: false,
                error: "Oanda request failed: fetch failed",
                retryInMs: 1000,
            })
        );
        expect(supervisor.isRetryScheduled()).toBe(true);
        expect(timers).toHaveLength(1);
    });

    test("recovers when the broker becomes reachable on a later retry", async () => {
        let attempts = 0;
        const { supervisor, engine, fireLastTimer } = createHarness({
            start: jest.fn(async () => {
                attempts += 1;
                if (attempts === 1) {
                    throw new Error("fetch failed");
                }
                engine.isRunning = true;
            }),
        });

        await supervisor.ensureStarted({ reason: "boot" });
        expect(engine.isRunning).toBe(false);

        await fireLastTimer();

        expect(engine.isRunning).toBe(true);
        expect(engine.startMonitoring).toHaveBeenCalledTimes(1);
        expect(supervisor.isRetryScheduled()).toBe(false);
    });

    test("backs off exponentially up to the cap", async () => {
        const { supervisor, fireLastTimer, timers } = createHarness({
            start: jest.fn(async () => {
                throw new Error("fetch failed");
            }),
        });

        await supervisor.ensureStarted();
        await fireLastTimer();
        await fireLastTimer();
        await fireLastTimer();

        expect(timers.map((timer) => timer.delayMs)).toEqual([
            1000, 2000, 4000, 4000,
        ]);
    });

    test("keeps a single pending retry so attempts cannot compound", async () => {
        const { supervisor, timers } = createHarness({
            start: jest.fn(async () => {
                throw new Error("fetch failed");
            }),
        });

        await supervisor.ensureStarted();
        await supervisor.ensureStarted();
        await supervisor.ensureStarted();

        expect(timers).toHaveLength(1);
    });

    test("collapses concurrent callers onto one start attempt", async () => {
        const { supervisor, engine } = createHarness();

        const results = await Promise.all([
            supervisor.ensureStarted({ reason: "boot" }),
            supervisor.ensureStarted({ reason: "live activation" }),
        ]);

        expect(engine.start).toHaveBeenCalledTimes(1);
        expect(results.every((result) => result.running === true)).toBe(true);
    });

    // Retrying would short-circuit on isRunning, so a monitoring failure must
    // not be treated as a failed attach or monitoring would stay off forever.
    test("keeps the engine attached when position monitoring fails to start", async () => {
        const { supervisor, logger } = createHarness({
            startMonitoring: jest.fn(() => {
                throw new Error("monitor boom");
            }),
        });

        const result = await supervisor.ensureStarted();

        expect(result).toEqual({ running: true });
        expect(supervisor.isRetryScheduled()).toBe(false);
        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining("position monitoring failed"),
            "monitor boom"
        );
    });

    test("cancelPendingRetry clears a scheduled attempt for shutdown", async () => {
        const { supervisor, timers } = createHarness({
            start: jest.fn(async () => {
                throw new Error("fetch failed");
            }),
        });

        await supervisor.ensureStarted();
        supervisor.cancelPendingRetry();

        expect(timers[0].cleared).toBe(true);
        expect(supervisor.isRetryScheduled()).toBe(false);
    });
});
