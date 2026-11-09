const SOURCE_FAILURE = 'Some dashboard observations are unavailable';

function immutable(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(immutable);
    Object.freeze(value);
  }
  return value;
}

function validateView(view) {
  if (view?.schemaVersion !== 1 || typeof view.streamId !== 'string' || !view.streamId ||
      !Number.isFinite(view.publication) || view.publication < 0 || !Number.isFinite(view.generatedAt) ||
      !view.overview || !view.observations) throw new Error('The operator response is not a valid dashboard view');
}

// The client owns observation ordering and transport lifetime. Display versions
// never authorize execution: commands are checked by the application module.
export function createLiveOperator({ transport, socket = null, requestTimeoutMs = 25000,
  fallbackPollMs = 30000, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout } = {}) {
  const listeners = new Set();
  const retiredStreams = new Set();
  const reads = new Set();
  const commands = new Map();
  let active = false;
  let epoch = 0;
  let readSequence = 0;
  let viewVersion = 0;
  let everConnected = false;
  let backendSubscribed = false;
  let pollTimer = null;
  let readError = null;
  let connectionError = null;
  let commandRefreshError = null;
  let commandSequence = 0;
  let state = Object.freeze({ view: null, loading: false, dataError: null, error: null,
    notice: null, action: null, pendingCommands: Object.freeze([]), lastUpdate: null, commandResult: null });

  function publish(updates = {}) {
    const next = { ...state, ...updates };
    const unavailable = Object.entries(next.view?.observations || {})
      .filter(([, observation]) => observation.status !== 'available').map(([source]) => source);
    const sourceError = unavailable.length
      ? `${SOURCE_FAILURE}: ${unavailable.join(', ')}. Displayed values may be from an earlier observation.` : null;
    next.dataError = [readError, connectionError, commandRefreshError, sourceError].filter(Boolean).join(' ') || null;
    state = Object.freeze(next);
    for (const listener of listeners) listener();
  }

  function adoptView(candidate, { startVersion = viewVersion, fromRead = false } = {}) {
    validateView(candidate);
    const current = state.view;
    if (current?.streamId === candidate.streamId && candidate.publication <= current.publication) return false;
    if (retiredStreams.has(candidate.streamId)) return false;
    if (current && current.streamId !== candidate.streamId) {
      // A read started before a newer socket observation cannot resurrect an
      // unknown old process, even if that old process had a larger counter.
      if (fromRead && startVersion !== viewVersion) return false;
      retiredStreams.add(current.streamId);
    }
    const view = immutable(structuredClone(candidate));
    viewVersion++;
    readError = null;
    publish({ view, lastUpdate: view.generatedAt });
    return true;
  }

  async function bounded(operation, onTimeout, signal = null) {
    let timer;
    let cancel;
    try {
      const cancellation = signal ? new Promise((_, reject) => {
        cancel = () => reject(new Error('The operator read was cancelled'));
        if (signal.aborted) cancel();
        else signal.addEventListener('abort', cancel, { once: true });
      }) : new Promise(() => {});
      return await Promise.race([operation, cancellation, new Promise((_, reject) => {
        timer = setTimeoutFn(() => {
          reject(new Error('The operator request timed out'));
          onTimeout?.();
        }, requestTimeoutMs);
      })]);
    } finally {
      clearTimeoutFn(timer);
      if (cancel) signal.removeEventListener('abort', cancel);
    }
  }

  async function refresh() {
    const sequence = ++readSequence;
    const requestEpoch = epoch;
    const startVersion = viewVersion;
    const controller = new AbortController();
    reads.add(controller);
    publish({ loading: true });
    try {
      const view = await bounded(Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new Error('The operator read was cancelled');
        return transport.readDashboard({ signal: controller.signal });
      }), () => controller.abort(), controller.signal);
      if (requestEpoch !== epoch || sequence !== readSequence) return state.view;
      adoptView(view, { fromRead: true, startVersion });
      readError = null;
      commandRefreshError = null;
      publish({ loading: false });
      return state.view;
    } catch (error) {
      if (requestEpoch === epoch && sequence === readSequence) {
        readError = `Operator refresh failed: ${error.message}. Displayed values may be stale.`;
        publish({ loading: false });
      }
      return null;
    } finally { reads.delete(controller); }
  }

  function pendingState() {
    const pending = [...commands.values()].sort((left, right) => left.sequence - right.sequence);
    return { action: pending.at(-1)?.action || null,
      pendingCommands: Object.freeze(pending.map((command) => command.action)) };
  }

  function command(name, action) {
    if (commands.has(action)) return commands.get(action).promise;
    const operation = { sequence: ++commandSequence, action, promise: null };
    const requestEpoch = epoch;
    const startVersion = viewVersion;
    commands.set(action, operation);
    commandRefreshError = null;
    publish({ ...pendingState(), error: null, notice: null, commandResult: null });
    operation.promise = (async () => {
      let result;
      try {
        // Enabling can include broker initialization and recovery. The read
        // deadline does not define a timeout for an in-progress mutation.
        result = await Promise.resolve().then(() => transport[name]());
      } catch (error) {
        result = error.payload?.outcome ? error.payload : {
          command: name, outcome: 'unknown', success: false, code: 'OPERATOR_RESULT_UNKNOWN',
          message: `The ${action} result is unknown: ${error.message}. Check the current operator view before trying again.`,
          error: error.message, view: null,
        };
      }
      if (!['accepted', 'rejected', 'failed', 'unresolved', 'unknown'].includes(result?.outcome)) {
        result = { command: name, outcome: 'unknown', success: false, code: 'OPERATOR_RESULT_UNKNOWN',
          message: `The ${action} result is unknown because the response was invalid.`, view: null };
      }
      operation.refreshPending = result.outcome === 'accepted' && result.refreshPending === true;
      let refreshError = result.refreshError || null;
      if (result.view && requestEpoch === epoch) {
        try { adoptView(result.view, { fromRead: true, startVersion }); }
        catch (error) { refreshError = error.message; }
      } else if (result.outcome === 'accepted' && !result.view && !refreshError) {
        refreshError = 'The command completed without an updated dashboard view';
      }
      if (operation.sequence === commandSequence) {
        commandRefreshError = refreshError ? `Dashboard refresh after ${action} failed: ${refreshError}.` : null;
        publish({ commandResult: immutable(structuredClone(result)),
          notice: result.outcome === 'accepted' ? result.message || 'Command accepted' : null,
          error: result.outcome === 'accepted' ? null : result.message || result.error || `Unable to ${action}` });
      }
      return result;
    })().finally(() => {
      commands.delete(action);
      publish(pendingState());
      // A confirmed pause must settle before its slower observations. Reading
      // afterward can update availability without changing command acceptance.
      if (operation.refreshPending && requestEpoch === epoch) void refresh();
    });
    return operation.promise;
  }

  function clearFeedback() {
    commandRefreshError = null;
    publish({ error: null, notice: null, commandResult: null });
  }

  function onView(view) {
    if (!active) return;
    try { adoptView(view); }
    catch (error) { readError = error.message; publish(); }
  }
  function onConnect() {
    if (!active) return;
    if (everConnected) { epoch++; readSequence++; }
    everConnected = true;
    if (!backendSubscribed) {
      backendSubscribed = true;
      socket?.emit('operatorSubscribe');
    }
    connectionError = null;
    publish();
    refresh();
  }
  function onDisconnect() {
    backendSubscribed = false;
    epoch++;
    readSequence++;
    connectionError = 'Live operator updates are disconnected; reconnecting will refresh the dashboard.';
    publish({ loading: false });
  }
  function onConnectionError() {
    connectionError = 'Live operator updates are unavailable; dashboard reads will continue.';
    publish();
  }
  function scheduleFallback() {
    pollTimer = setTimeoutFn(() => {
      if (!active) return;
      // The backend refreshes observed views while connected. HTTP polling is
      // only a fallback, avoiding two full broker reads every interval.
      if (!socket?.connected) refresh();
      scheduleFallback();
    }, fallbackPollMs);
    pollTimer?.unref?.();
  }
  function start() {
    active = true;
    socket?.on('operatorView', onView);
    socket?.on('connect', onConnect);
    socket?.on('disconnect', onDisconnect);
    socket?.on('connect_error', onConnectionError);
    if (socket?.connected) onConnect();
    else { refresh(); socket?.connect(); }
    scheduleFallback();
  }
  function stop() {
    active = false;
    epoch++;
    readSequence++;
    clearTimeoutFn(pollTimer);
    pollTimer = null;
    socket?.off('operatorView', onView);
    socket?.off('connect', onConnect);
    socket?.off('disconnect', onDisconnect);
    socket?.off('connect_error', onConnectionError);
    if (backendSubscribed) {
      backendSubscribed = false;
      socket?.emit('operatorUnsubscribe');
    }
    for (const controller of reads) controller.abort();
    publish({ loading: false });
  }
  function subscribe(listener) {
    listeners.add(listener);
    if (!active) start();
    return () => {
      listeners.delete(listener);
      if (!listeners.size && active) stop();
    };
  }
  function observeDashboard(listener) {
    let previous = state.view;
    const unsubscribe = subscribe(() => {
      if (state.view && state.view !== previous) { previous = state.view; listener(state.view); }
    });
    if (previous) listener(previous);
    return unsubscribe;
  }

  return Object.freeze({ subscribe, observeDashboard, getSnapshot: () => state,
    refresh, readDashboard: refresh,
    enableEntries: () => command('enableEntries', 'enable'),
    pauseEntries: () => command('pauseEntries', 'pause'),
    reconcileBroker: () => command('reconcileBroker', 'reconcile'),
    clearFeedback,
    dispose: () => { listeners.clear(); stop(); } });
}
