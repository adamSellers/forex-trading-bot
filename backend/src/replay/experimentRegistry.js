const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { hashValue } = require("./walkForwardValidator");

function createExperimentRecord(input = {}) {
    if (!input.strategy) throw new Error("Experiment strategy is required");
    if (!input.datasetHash) throw new Error("Experiment datasetHash is required");
    const createdAt = input.createdAt || new Date().toISOString();
    const record = {
        schemaVersion: 1,
        createdAt,
        strategy: input.strategy,
        hypothesis: input.hypothesis || null,
        variantSetHash: input.variantSetHash || hashValue(input.variants || []),
        datasetHash: input.datasetHash,
        codeRevision: input.codeRevision || null,
        referenceCurrency: "AUD",
        result: input.result || null,
        notes: input.notes || null,
    };
    return {
        experimentId: crypto.createHash("sha256").update(JSON.stringify(record)).digest("hex").slice(0, 20),
        ...record,
    };
}

function appendExperiment(filePath, input) {
    const record = createExperimentRecord(input);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, {
        encoding: "utf8",
        flag: "a",
    });
    return record;
}

function readExperiments(filePath) {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

module.exports = { appendExperiment, createExperimentRecord, readExperiments };
