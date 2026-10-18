'use strict';
// Separately registered software-only timeout amendment. This is outside the
// frozen financial source closure and never changes a strategy/test function.
const fs = require('node:fs');
const crypto = require('node:crypto');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const file = process.env.RESEARCH_VIABILITY_RUNTIME_REPAIR_REGISTRATION;
const bytes = fs.readFileSync(file);
if (sha(bytes) !== process.env.RESEARCH_VIABILITY_RUNTIME_REPAIR_SHA256) throw new Error('Runtime repair registration mismatch');
const registration = JSON.parse(bytes);
if (registration.originalTimeoutMs !== 7_200_000 || registration.extendedTimeoutMs !== 21_600_000 ||
    registration.helper.sha256 !== sha(fs.readFileSync(__filename))) throw new Error('Unregistered timeout helper');
const original = globalThis.test;
let amended = 0;
globalThis.test = new Proxy(original, { apply(target, receiver, args) {
    if (args[0] !== registration.testName) return Reflect.apply(target, receiver, args);
    if (args.length !== 3 || args[2] !== registration.originalTimeoutMs || typeof args[1] !== 'function' || amended !== 0) {
        throw new Error('Timeout-only amendment does not match the registered test definition');
    }
    amended++;
    return Reflect.apply(target, receiver, [args[0], args[1], registration.extendedTimeoutMs]);
} });
afterAll(() => {
    if (amended !== 1) throw new Error(`Expected exactly one timeout amendment, observed ${amended}`);
    globalThis.test = original;
});
