const { db } = require("../../config/database");
const logger = require("../utils/logger");

const ACTIVE_INTENT_STATUSES = [
    "PREPARED",
    "SUBMITTING",
    "AMBIGUOUS",
    "RECOVERY_PENDING",
    "FILLED_UNPERSISTED",
];

class BrokerLifecycleRepository {
    constructor(database = db) {
        this.db = database;
    }

    serialize(value) {
        if (value === undefined) return undefined;
        if (value === null) return null;
        return typeof value === "string" ? value : JSON.stringify(value);
    }

    parse(value) {
        if (!value || typeof value !== "string") return value || null;
        try {
            return JSON.parse(value);
        } catch {
            logger.warn("Failed to parse broker lifecycle JSON payload");
            return null;
        }
    }

    number(value) {
        if (value === null || value === undefined || value === "") return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    mapIntent(row) {
        if (!row) return null;
        return {
            intentId: row.intent_id,
            clientOrderId: row.client_order_id,
            clientTradeId: row.client_trade_id,
            decisionId: row.decision_id,
            tradeId: row.trade_id,
            brokerTradeId: row.broker_trade_id,
            brokerOrderId: row.broker_order_id,
            lastTransactionId: row.last_transaction_id,
            status: row.status,
            instrument: row.instrument,
            side: row.side,
            units: this.number(row.units),
            referencePrice: this.number(row.reference_price),
            finalQuote: this.number(row.final_quote),
            priceBound: this.number(row.price_bound),
            attemptCount: this.number(row.attempt_count) || 0,
            nextRetryAt: this.number(row.next_retry_at),
            lastError: row.last_error,
            requestPayload: this.parse(row.request_payload),
            responsePayload: this.parse(row.response_payload),
            contextPayload: this.parse(row.context_payload),
            createdAt: this.number(row.created_at_ms),
            submittedAt: this.number(row.submitted_at_ms),
            resolvedAt: this.number(row.resolved_at_ms),
        };
    }

    async createIntent(intent) {
        const now = intent.createdAt || Date.now();
        await this.db("broker_order_intents").insert({
            intent_id: intent.intentId,
            client_order_id: intent.clientOrderId,
            client_trade_id: intent.clientTradeId,
            decision_id: intent.decisionId || null,
            trade_id: intent.tradeId || null,
            broker_trade_id: intent.brokerTradeId || null,
            broker_order_id: intent.brokerOrderId || null,
            last_transaction_id: intent.lastTransactionId || null,
            status: intent.status || "PREPARED",
            instrument: intent.instrument,
            side: intent.side,
            units: intent.units,
            reference_price: intent.referencePrice ?? null,
            final_quote: intent.finalQuote ?? null,
            price_bound: intent.priceBound ?? null,
            attempt_count: intent.attemptCount || 0,
            next_retry_at: intent.nextRetryAt || null,
            last_error: intent.lastError || null,
            request_payload: this.serialize(intent.requestPayload),
            response_payload: this.serialize(intent.responsePayload),
            context_payload: this.serialize(intent.contextPayload),
            created_at_ms: now,
            submitted_at_ms: intent.submittedAt || null,
            resolved_at_ms: intent.resolvedAt || null,
            created_at: new Date(),
            updated_at: new Date(),
        });
        return this.getIntent(intent.intentId);
    }

    async updateIntent(intentId, updates = {}) {
        const row = { updated_at: new Date() };
        const fields = {
            clientOrderId: "client_order_id",
            clientTradeId: "client_trade_id",
            decisionId: "decision_id",
            tradeId: "trade_id",
            brokerTradeId: "broker_trade_id",
            brokerOrderId: "broker_order_id",
            lastTransactionId: "last_transaction_id",
            status: "status",
            instrument: "instrument",
            side: "side",
            units: "units",
            referencePrice: "reference_price",
            finalQuote: "final_quote",
            priceBound: "price_bound",
            attemptCount: "attempt_count",
            nextRetryAt: "next_retry_at",
            lastError: "last_error",
            createdAt: "created_at_ms",
            submittedAt: "submitted_at_ms",
            resolvedAt: "resolved_at_ms",
        };
        for (const [key, column] of Object.entries(fields)) {
            if (updates[key] !== undefined) row[column] = updates[key];
        }
        for (const [key, column] of [
            ["requestPayload", "request_payload"],
            ["responsePayload", "response_payload"],
            ["contextPayload", "context_payload"],
        ]) {
            if (updates[key] !== undefined) row[column] = this.serialize(updates[key]);
        }
        await this.db("broker_order_intents")
            .where("intent_id", intentId)
            .update(row);
        return this.getIntent(intentId);
    }

    async getIntent(intentId) {
        const row = await this.db("broker_order_intents")
            .where("intent_id", intentId)
            .first();
        return this.mapIntent(row);
    }

    async getIntentByBrokerTradeId(brokerTradeId) {
        const row = await this.db("broker_order_intents")
            .where("broker_trade_id", String(brokerTradeId))
            .orderBy("created_at_ms", "desc")
            .first();
        return this.mapIntent(row);
    }

    async getIntentByClientTradeId(clientTradeId) {
        const row = await this.db("broker_order_intents")
            .where("client_trade_id", clientTradeId)
            .first();
        return this.mapIntent(row);
    }

    async getRecoverableIntents() {
        const rows = await this.db("broker_order_intents")
            .whereIn("status", ACTIVE_INTENT_STATUSES)
            .orderBy("created_at_ms", "asc");
        return rows.map((row) => this.mapIntent(row));
    }

    mapQuarantine(row) {
        if (!row) return null;
        return {
            brokerTradeId: row.broker_trade_id,
            intentId: row.intent_id,
            instrument: row.instrument,
            side: row.side,
            units: this.number(row.units),
            status: row.status,
            reason: row.reason,
            brokerPayload: this.parse(row.broker_payload),
            firstSeenAt: this.number(row.first_seen_at),
            lastSeenAt: this.number(row.last_seen_at),
            resolvedAt: this.number(row.resolved_at),
        };
    }

    async quarantineBrokerTrade(record) {
        const now = record.lastSeenAt || Date.now();
        const payload = {
            intent_id: record.intentId || null,
            instrument: record.instrument,
            side: record.side || null,
            units: record.units ?? null,
            status: record.status || "OPEN",
            reason: record.reason,
            broker_payload: this.serialize(record.brokerPayload),
            last_seen_at: now,
            resolved_at: record.resolvedAt || null,
            updated_at: new Date(),
        };
        await this.db("broker_position_quarantines")
            .insert({
                broker_trade_id: String(record.brokerTradeId),
                first_seen_at: record.firstSeenAt || now,
                created_at: new Date(),
                ...payload,
            })
            .onConflict("broker_trade_id")
            .merge(payload);
        return this.getQuarantine(record.brokerTradeId);
    }

    async getQuarantine(brokerTradeId) {
        const row = await this.db("broker_position_quarantines")
            .where("broker_trade_id", String(brokerTradeId))
            .first();
        return this.mapQuarantine(row);
    }

    async getOpenQuarantines() {
        const rows = await this.db("broker_position_quarantines")
            .where("status", "OPEN")
            .orderBy("last_seen_at", "desc");
        return rows.map((row) => this.mapQuarantine(row));
    }

    async resolveMissingQuarantines(openBrokerTradeIds, resolvedAt = Date.now()) {
        const query = this.db("broker_position_quarantines").where("status", "OPEN");
        const ids = [...openBrokerTradeIds].map(String);
        if (ids.length > 0) query.whereNotIn("broker_trade_id", ids);
        return query.update({
            status: "RESOLVED",
            resolved_at: resolvedAt,
            updated_at: new Date(),
        });
    }

    async getState(key) {
        const row = await this.db("broker_runtime_state")
            .where("state_key", key)
            .first();
        return row ? this.parse(row.state_value) : null;
    }

    async setState(key, value, updatedAt = Date.now()) {
        const payload = {
            state_value: this.serialize(value),
            updated_at_ms: updatedAt,
            updated_at: new Date(),
        };
        await this.db("broker_runtime_state")
            .insert({ state_key: key, ...payload })
            .onConflict("state_key")
            .merge(payload);
        return value;
    }
}

BrokerLifecycleRepository.ACTIVE_INTENT_STATUSES = ACTIVE_INTENT_STATUSES;

module.exports = BrokerLifecycleRepository;
