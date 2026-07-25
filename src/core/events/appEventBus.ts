import type { AppEventMap } from '../contracts/events';

type EventListener<K extends keyof AppEventMap> = (payload: AppEventMap[K]) => void;

export interface AppEventBus {
  emit<K extends keyof AppEventMap>(event: K, payload: AppEventMap[K]): void;
  subscribe<K extends keyof AppEventMap>(event: K, listener: EventListener<K>): () => void;
}

export function createAppEventBus(): AppEventBus {
  const listeners = new Map<keyof AppEventMap, Set<(payload: unknown) => void>>();

  return {
    emit(event, payload) {
      listeners.get(event)?.forEach((listener) => listener(payload));
    },
    subscribe(event, listener) {
      const eventListeners = listeners.get(event) ?? new Set<(payload: unknown) => void>();
      const wrappedListener = (payload: unknown) => listener(payload as AppEventMap[typeof event]);
      eventListeners.add(wrappedListener);
      listeners.set(event, eventListeners);
      return () => {
        eventListeners.delete(wrappedListener);
        if (eventListeners.size === 0) listeners.delete(event);
      };
    },
  };
}

export const appEventBus = createAppEventBus();
