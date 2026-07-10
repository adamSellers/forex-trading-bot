function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function getInstrumentConfig(config = {}, instrument) {
    return (
        config.paperFinancingRates?.[instrument] ||
        config.financingRates?.[instrument] ||
        {}
    );
}

function hasConfiguredValue(object, keys) {
    return keys.some(
        (key) =>
            Object.prototype.hasOwnProperty.call(object || {}, key) &&
            object[key] !== null &&
            object[key] !== undefined &&
            object[key] !== ""
    );
}

function resolveFinancingRate(config = {}, trade = {}, asOf = Date.now()) {
    const instrumentConfig = getInstrumentConfig(config, trade.instrument);
    const isLong = trade.side !== "SELL";
    const sideKeys = isLong
        ? ["longRateAnnual", "longRate", "long"]
        : ["shortRateAnnual", "shortRate", "short"];
    const genericKeys = [
        "paperFinancingRateAnnual",
        "financingRateAnnual",
    ];
    const sideRate = isLong
        ? instrumentConfig.longRateAnnual ??
          instrumentConfig.longRate ??
          instrumentConfig.long
        : instrumentConfig.shortRateAnnual ??
          instrumentConfig.shortRate ??
          instrumentConfig.short;
    const configured =
        hasConfiguredValue(instrumentConfig, sideKeys) ||
        hasConfiguredValue(config, genericKeys);
    const annualRate = toFiniteNumber(
        sideRate ??
            config.paperFinancingRateAnnual ??
            config.financingRateAnnual,
        0
    );
    const updatedAt = toFiniteNumber(instrumentConfig.updatedAt, null);
    const maxAgeMs = Math.max(
        0,
        toFiniteNumber(config.paperFinancingRateMaxAgeMs, 24 * 60 * 60 * 1000)
    );

    if (!configured) {
        return {
            annualRate: 0,
            status:
                instrumentConfig.status || "UNMODELED_MISSING_FINANCING_RATE",
            source: instrumentConfig.source || null,
            updatedAt,
        };
    }
    if (
        Number.isFinite(updatedAt) &&
        maxAgeMs > 0 &&
        asOf - updatedAt > maxAgeMs
    ) {
        return {
            annualRate: 0,
            status: "UNMODELED_STALE_FINANCING_RATE",
            source: instrumentConfig.source || null,
            updatedAt,
        };
    }

    return {
        annualRate,
        status: "MODELED",
        source: instrumentConfig.source || "CONFIG",
        updatedAt,
    };
}

function resolveFinancingAnnualRate(config = {}, trade = {}) {
    return resolveFinancingRate(config, trade).annualRate;
}

function countRolloverDayWeights({
    entryTime,
    exitTime,
    cutoffHourUtc = 21,
    cutoffTimeZone = null,
    cutoffLocalHour = 17,
    tripleRolloverWeekday = 3,
    financingDaysOfWeek = null,
} = {}) {
    const entry = toFiniteNumber(entryTime, 0);
    const exit = toFiniteNumber(exitTime, entry);
    if (entry <= 0 || exit <= entry) return 0;

    const weekdayIndex = {
        SUNDAY: 0,
        MONDAY: 1,
        TUESDAY: 2,
        WEDNESDAY: 3,
        THURSDAY: 4,
        FRIDAY: 5,
        SATURDAY: 6,
    };
    const schedule = new Map(
        (Array.isArray(financingDaysOfWeek) ? financingDaysOfWeek : [])
            .map((item) => {
                const rawDay = item?.dayOfWeek;
                const day = Number.isFinite(Number(rawDay))
                    ? Number(rawDay)
                    : weekdayIndex[String(rawDay || "").toUpperCase()];
                const daysCharged = toFiniteNumber(item?.daysCharged, null);
                return Number.isFinite(day) && Number.isFinite(daysCharged)
                    ? [day, Math.max(0, daysCharged)]
                    : null;
            })
            .filter(Boolean)
    );

    const getDayWeight = (day) =>
        schedule.has(day)
            ? schedule.get(day)
            : day === 0 || day === 6
              ? 0
            : day === Number(tripleRolloverWeekday)
              ? 3
              : 1;
    let dayWeights = 0;

    if (cutoffTimeZone) {
        const formatter = new Intl.DateTimeFormat("en-US", {
            timeZone: cutoffTimeZone,
            weekday: "long",
            hour: "numeric",
            minute: "numeric",
            hourCycle: "h23",
        });
        let cursorMs =
            Math.floor(entry / (60 * 60 * 1000)) * (60 * 60 * 1000);
        if (cursorMs <= entry) cursorMs += 60 * 60 * 1000;

        while (cursorMs <= exit) {
            const parts = Object.fromEntries(
                formatter
                    .formatToParts(new Date(cursorMs))
                    .filter((part) => part.type !== "literal")
                    .map((part) => [part.type, part.value])
            );
            if (
                Number(parts.hour) === Number(cutoffLocalHour) &&
                Number(parts.minute) === 0
            ) {
                const day = weekdayIndex[String(parts.weekday).toUpperCase()];
                if (Number.isFinite(day)) dayWeights += getDayWeight(day);
            }
            cursorMs += 60 * 60 * 1000;
        }
        return dayWeights;
    }

    const cursor = new Date(entry);
    cursor.setUTCHours(
        Math.max(0, Math.min(23, toFiniteNumber(cutoffHourUtc, 21))),
        0,
        0,
        0
    );
    if (cursor.getTime() <= entry) cursor.setUTCDate(cursor.getUTCDate() + 1);
    while (cursor.getTime() <= exit) {
        dayWeights += getDayWeight(cursor.getUTCDay());
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return dayWeights;
}

function calculateFinancingAud({ trade = {}, config = {}, exitTime }) {
    const instrumentConfig = getInstrumentConfig(config, trade.instrument);
    const configuredUtcCutoff =
        config.paperFinancingCutoffHourUtc ?? config.financingCutoffHourUtc;
    const dayWeights = countRolloverDayWeights({
        entryTime: trade.entryTime,
        exitTime,
        cutoffHourUtc: configuredUtcCutoff ?? 21,
        cutoffTimeZone:
            configuredUtcCutoff === undefined || configuredUtcCutoff === null
                ? config.paperFinancingCutoffTimeZone ||
                  config.financingCutoffTimeZone ||
                  "America/New_York"
                : null,
        cutoffLocalHour:
            config.paperFinancingCutoffLocalHour ??
            config.financingCutoffLocalHour ??
            17,
        tripleRolloverWeekday:
            config.paperTripleRolloverWeekday ??
            config.tripleRolloverWeekday ??
            3,
        financingDaysOfWeek: instrumentConfig.financingDaysOfWeek,
    });
    const rate = resolveFinancingRate(config, trade, exitTime);
    const notionalAud = Math.max(
        0,
        toFiniteNumber(trade.entryNotionalAud ?? trade.entryCostAud, 0)
    );
    const financingAud =
        notionalAud > 0 && dayWeights > 0 && rate.status === "MODELED"
            ? (notionalAud * rate.annualRate * dayWeights) / 365
            : 0;

    return {
        financingAud,
        annualRate: rate.annualRate,
        dayWeights,
        status:
            dayWeights === 0
                ? "NOT_APPLICABLE_NO_ROLLOVER"
                : rate.status,
        mode:
            dayWeights === 0 || rate.status === "MODELED"
                ? "MODELED"
                : "UNMODELED",
        source: rate.source,
        rateUpdatedAt: rate.updatedAt,
    };
}

function calculateCommissionAud({ trade = {}, config = {} }) {
    const units = Math.abs(toFiniteNumber(trade.units, 0));
    const notionalAud = Math.max(
        0,
        toFiniteNumber(trade.entryNotionalAud ?? trade.entryCostAud, 0)
    );
    const sides = Math.max(
        1,
        toFiniteNumber(config.paperCommissionSides, 2)
    );
    const flat = Math.max(
        0,
        toFiniteNumber(
            config.paperCommissionPerTradeAud ?? config.commissionPerTradeAud,
            0
        )
    );
    const perUnit = Math.max(
        0,
        toFiniteNumber(
            config.paperCommissionPerUnitAud ?? config.commissionPerUnitAud,
            0
        )
    );
    const perMillion = Math.max(
        0,
        toFiniteNumber(
            config.paperCommissionPerMillionAud ??
                config.commissionPerMillionAud,
            0
        )
    );
    return flat + perUnit * units * sides + (perMillion * notionalAud * sides) / 1_000_000;
}

function getCommissionStatus(config = {}) {
    return hasConfiguredValue(config, [
        "paperCommissionPerTradeAud",
        "commissionPerTradeAud",
        "paperCommissionPerUnitAud",
        "commissionPerUnitAud",
        "paperCommissionPerMillionAud",
        "commissionPerMillionAud",
    ])
        ? "MODELED"
        : "ASSUMED_ZERO_UNCONFIGURED";
}

function calculateExecutionCostsAud({
    trade = {},
    pipValue,
    entryQuoteToAudRate,
    exitQuoteToAudRate,
    entrySpreadPips = 0,
    exitSpreadPips = 0,
    entrySlippagePips = 0,
    exitSlippagePips = 0,
} = {}) {
    const units = Math.abs(toFiniteNumber(trade.units, 0));
    const pip = Math.max(0, toFiniteNumber(pipValue, 0));
    const entryRate = Math.max(0, toFiniteNumber(entryQuoteToAudRate, 0));
    const exitRate = Math.max(
        0,
        toFiniteNumber(exitQuoteToAudRate, entryRate)
    );
    const entryPipAud = units * pip * entryRate;
    const exitPipAud = units * pip * exitRate;
    // Each market side crosses half of the quoted bid/ask spread.
    const spreadCostAud =
        (Math.max(0, toFiniteNumber(entrySpreadPips, 0)) / 2) * entryPipAud +
        (Math.max(0, toFiniteNumber(exitSpreadPips, 0)) / 2) * exitPipAud;
    const slippageCostAud =
        Math.max(0, toFiniteNumber(entrySlippagePips, 0)) * entryPipAud +
        Math.max(0, toFiniteNumber(exitSlippagePips, 0)) * exitPipAud;
    return { spreadCostAud, slippageCostAud };
}

/**
 * Fill P&L already contains spread/slippage. This function attributes those
 * costs, then applies explicit commission and signed financing (negative is a
 * charge, positive is a credit) exactly once.
 */
function calculatePaperNetPnl({
    trade = {},
    config = {},
    fillPnlAud,
    pipValue,
    entryQuoteToAudRate,
    exitQuoteToAudRate,
    entrySpreadPips,
    exitSpreadPips,
    entrySlippagePips,
    exitSlippagePips,
    exitTime,
} = {}) {
    const execution = calculateExecutionCostsAud({
        trade,
        pipValue,
        entryQuoteToAudRate,
        exitQuoteToAudRate,
        entrySpreadPips,
        exitSpreadPips,
        entrySlippagePips,
        exitSlippagePips,
    });
    const commissionAud = calculateCommissionAud({ trade, config });
    const financing = calculateFinancingAud({ trade, config, exitTime });
    const fillNetExecutionPnlAud = toFiniteNumber(fillPnlAud, 0);
    const grossPnlAud =
        fillNetExecutionPnlAud +
        execution.spreadCostAud +
        execution.slippageCostAud;
    const totalCostAud =
        execution.spreadCostAud +
        execution.slippageCostAud +
        commissionAud -
        financing.financingAud;
    const pnlAud = grossPnlAud - totalCostAud;

    return {
        pnlAud,
        grossPnlAud,
        fillNetExecutionPnlAud,
        spreadCostAud: execution.spreadCostAud,
        slippageCostAud: execution.slippageCostAud,
        commissionAud,
        commissionStatus: getCommissionStatus(config),
        financingAud: financing.financingAud,
        financingRateAnnual: financing.annualRate,
        financingDayWeights: financing.dayWeights,
        financingMode: financing.mode,
        financingStatus: financing.status,
        financingSource: financing.source,
        financingRateUpdatedAt: financing.rateUpdatedAt,
        spreadStatus:
            entrySpreadPips !== null &&
            entrySpreadPips !== undefined &&
            exitSpreadPips !== null &&
            exitSpreadPips !== undefined
                ? "MODELED"
                : "UNMODELED_MISSING_SPREAD",
        slippageStatus: "MODELED",
        totalCostAud,
        costModelVersion: 1,
    };
}

module.exports = {
    calculateCommissionAud,
    calculateExecutionCostsAud,
    calculateFinancingAud,
    calculatePaperNetPnl,
    countRolloverDayWeights,
    resolveFinancingRate,
    resolveFinancingAnnualRate,
};
