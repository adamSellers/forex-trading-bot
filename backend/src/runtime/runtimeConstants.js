const RUNTIME_MODES = Object.freeze({
    LIVE: "live",
});

const RUN_STATUSES = Object.freeze({
    ACTIVE: "active",
    MANAGING_ONLY: "managing_only",
    STOPPED: "stopped",
});

module.exports = {
    RUNTIME_MODES,
    RUN_STATUSES,
};
