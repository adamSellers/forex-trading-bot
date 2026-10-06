// Research-only clock. Advancing observations never dispatches polling timers;
// the replay runner owns scheduling and must call production work explicitly.
const { performance: nodePerformance } = require('node:perf_hooks');

let installedClock = null;

function requireTime(value, label) {
    if (!Number.isFinite(value) || Math.abs(value) > 8.64e15) {
        throw new TypeError(`${label} must be a finite millisecond timestamp`);
    }
    return value;
}

class ReplayClock {
    constructor(startMs, { monotonicMs = 0 } = {}) {
        this._wallMs = requireTime(startMs, 'Replay start');
        this._monotonicMs = requireTime(monotonicMs, 'Monotonic start');
        if (monotonicMs < 0) throw new RangeError('Monotonic start cannot be negative');
        this._restore = null;
    }

    // Date uses integer milliseconds; retain fractional latency internally so
    // several sub-millisecond advances still accumulate in monotonic time.
    nowMs() { return Math.trunc(this._wallMs); }
    monoMs() { return this._monotonicMs; }

    advance(ms) {
        if (!Number.isFinite(ms) || ms < 0) {
            throw new RangeError('Replay elapsed time must be finite and nonnegative');
        }
        const nextWallMs = requireTime(this._wallMs + ms, 'Replay time');
        const nextMonotonicMs = requireTime(this._monotonicMs + ms, 'Monotonic time');
        this._wallMs = nextWallMs;
        this._monotonicMs = nextMonotonicMs;
        return this.nowMs();
    }

    set(timeMs) {
        requireTime(timeMs, 'Replay time');
        if (timeMs < this._wallMs) {
            throw new RangeError('Replay time cannot rewind; create a new clock for a new replay');
        }
        return this.advance(timeMs - this._wallMs);
    }

    install() {
        if (this._restore) return this._restore;
        if (installedClock) throw new Error('A replay clock is already installed in this process');
        const clock = this;
        const NativeDate = globalThis.Date;
        const dateDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Date');
        const changes = [];
        let restored = false;
        function ReplayDate(...args) {
            if (!new.target) return new NativeDate(clock.nowMs()).toString();
            return Reflect.construct(NativeDate, args.length ? args : [clock.nowMs()], new.target);
        }
        Object.setPrototypeOf(ReplayDate, NativeDate);
        ReplayDate.prototype = NativeDate.prototype;
        Object.defineProperty(ReplayDate, 'name', { value: 'Date' });
        Object.defineProperty(ReplayDate, 'now', { value: () => clock.nowMs(),
            writable: true, configurable: true });

        const restore = () => {
            if (restored) return;
            restored = true;
            for (const { target, property, descriptor } of changes.reverse()) {
                if (descriptor) Object.defineProperty(target, property, descriptor);
                else delete target[property];
            }
            if (dateDescriptor) Object.defineProperty(globalThis, 'Date', dateDescriptor);
            else delete globalThis.Date;
            clock._restore = null;
            if (installedClock === clock) installedClock = null;
        };
        try {
            Object.defineProperty(globalThis, 'Date', { ...dateDescriptor, value: ReplayDate });
            // DataService keeps a destructured perf_hooks object at module load;
            // patch the object's method, rather than replacing the export. The
            // engine reads global performance, which Jest may represent separately.
            for (const target of new Set([nodePerformance, globalThis.performance].filter(Boolean))) {
                const descriptor = Object.getOwnPropertyDescriptor(target, 'now');
                Object.defineProperty(target, 'now', { value: () => clock.monoMs(),
                    writable: true, configurable: true, enumerable: descriptor?.enumerable ?? false });
                changes.push({ target, property: 'now', descriptor });
            }
            installedClock = clock;
            this._restore = restore;
            return restore;
        } catch (error) {
            restore();
            throw error;
        }
    }

    restore() { this._restore?.(); }
}

module.exports = { ReplayClock };
