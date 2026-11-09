import { useSyncExternalStore } from 'react';
import { operatorAPI, socket } from '../config/api';
import { createLiveOperator } from './liveOperator';

export const liveOperator = createLiveOperator({ transport: operatorAPI, socket });

export function useLiveOperator(operator = liveOperator) {
  const state = useSyncExternalStore(operator.subscribe, operator.getSnapshot, operator.getSnapshot);
  return {
    ...state,
    refresh: operator.refresh,
    enableEntries: operator.enableEntries,
    pauseEntries: operator.pauseEntries,
    reconcileBroker: operator.reconcileBroker,
    clearFeedback: operator.clearFeedback,
  };
}

export default useLiveOperator;
