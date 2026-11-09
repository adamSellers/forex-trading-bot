// One serialized lifecycle for broker snapshots, entries, closes and protection.
// Operations inside a transaction receive scoped commands: nested work stays in
// that transaction, while independent callers always join the same FIFO queue.
class BrokerLifecycle {
    #tail = Promise.resolve();
    #trades;
    #operations;

    constructor({ trades, operations }) {
        this.#trades = trades;
        this.#operations = operations;
    }

    #currentTrade(trade) {
        return this.#trades.get(typeof trade === "string" ? trade : trade.id);
    }

    #commands() {
        const commands = {
            reconcile: (options = {}) => this.#operations.reconcile({ ...options, lifecycle: commands }),
            enter: (signal, config, decisionId, validationContext, generation) =>
                this.#operations.enter(signal, config, decisionId, validationContext, generation, commands),
            close: (trade, price, reason) => {
                const current = this.#currentTrade(trade);
                return current ? this.#operations.close(current, price, reason) : null;
            },
            tightenStop: (trade, price, type, updates = {}, retry = null) => {
                const current = this.#currentTrade(trade);
                return current
                    ? this.#operations.tightenStop(current, price, type, updates, retry, commands)
                    : false;
            },
            forTrade: (trade, operation) => {
                const current = this.#currentTrade(trade);
                return current ? operation(current, commands) : false;
            },
        };
        return Object.freeze(commands);
    }

    transaction(operation) {
        const result = this.#tail.then(() => operation(this.#commands()));
        // A failed operation still reaches its caller, without poisoning later
        // reconciliation or protective work already waiting in the queue.
        this.#tail = result.catch(() => {});
        return result;
    }

    reconcile(options) {
        return this.transaction((commands) => commands.reconcile(options));
    }

    enter(signal, config, decisionId, validationContext, generation) {
        return this.transaction((commands) =>
            commands.enter(signal, config, decisionId, validationContext, generation));
    }

    close(trade, price, reason) {
        return this.transaction((commands) => commands.close(trade, price, reason));
    }

    tightenStop(trade, price, type, updates, retry) {
        return this.transaction((commands) => commands.tightenStop(trade, price, type, updates, retry));
    }

    forTrade(trade, operation) {
        return this.transaction((commands) => commands.forTrade(trade, operation));
    }
}

module.exports = BrokerLifecycle;
