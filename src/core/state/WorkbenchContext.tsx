import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import type { AgentProvider, ProviderCapability } from '../contracts/agents';
import type { WorkbenchSnapshot } from '../contracts/workbenchData';
import type { PrototypeRepository } from '../data/prototypeRepository';
import { useI18n } from '../i18n/I18nContext';

export type CapabilityDiscovery = () => Promise<Partial<Record<AgentProvider, ProviderCapability>>>;
export type SnapshotMutator = (snapshot: WorkbenchSnapshot) => WorkbenchSnapshot;

type WorkbenchLoadState = 'loading' | 'ready' | 'error';

interface WorkbenchState {
  loadState: WorkbenchLoadState;
  snapshot: WorkbenchSnapshot | null;
  warning: string | null;
  error: string | null;
  saving: boolean;
}

type WorkbenchAction =
  | { type: 'loaded'; snapshot: WorkbenchSnapshot; warning: string | null }
  | { type: 'load-failed'; message: string }
  | { type: 'snapshot-updated'; snapshot: WorkbenchSnapshot }
  | { type: 'save-begin' }
  | { type: 'save-succeeded' }
  | { type: 'save-failed'; message: string };

const initialState: WorkbenchState = {
  loadState: 'loading',
  snapshot: null,
  warning: null,
  error: null,
  saving: false,
};

function reducer(state: WorkbenchState, action: WorkbenchAction): WorkbenchState {
  switch (action.type) {
    case 'loaded':
      return {
        loadState: 'ready',
        snapshot: action.snapshot,
        warning: action.warning,
        error: null,
        saving: false,
      };
    case 'load-failed':
      return { ...state, loadState: 'error', error: action.message, saving: false };
    case 'snapshot-updated':
      return { ...state, snapshot: action.snapshot };
    case 'save-begin':
      return { ...state, saving: true, error: null };
    case 'save-succeeded':
      return { ...state, saving: false };
    case 'save-failed':
      return { ...state, saving: false, error: action.message };
  }
}

interface WorkbenchContextValue extends WorkbenchState {
  repository: PrototypeRepository;
  saveSnapshot: (snapshot: WorkbenchSnapshot) => Promise<void>;
  updateSnapshot: (mutate: SnapshotMutator, options?: { persist?: boolean }) => void;
  flushPending: () => Promise<void>;
  resetSnapshot: () => Promise<WorkbenchSnapshot>;
}

const WorkbenchContext = createContext<WorkbenchContextValue | null>(null);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Workbench data could not be loaded.';
}

const CLOSE_FLUSH_INTERVAL_MS = 120_000;

export function WorkbenchProvider({
  children,
  repository,
  discoverCapabilities,
}: {
  children: ReactNode;
  repository: PrototypeRepository;
  discoverCapabilities?: CapabilityDiscovery;
}) {
  const { text } = useI18n();
  const [state, dispatch] = useReducer(reducer, initialState);
  const snapshotRef = useRef<WorkbenchSnapshot | null>(null);
  const snapshotVersionRef = useRef(0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const dirtyVersionRef = useRef<number | null>(null);

  const enqueueSave = useCallback(
    (snapshot: WorkbenchSnapshot, version: number): Promise<void> => {
      const attempt = saveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          dispatch({ type: 'save-begin' });
          try {
            await repository.save(snapshot);
            if (dirtyVersionRef.current !== null && dirtyVersionRef.current <= version) {
              dirtyVersionRef.current = null;
            }
            dispatch({ type: 'save-succeeded' });
          } catch (error) {
            dispatch({ type: 'save-failed', message: errorMessage(error) });
            throw error;
          }
        });
      saveQueueRef.current = attempt.catch(() => undefined);
      return attempt;
    },
    [repository],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let snapshot: WorkbenchSnapshot;
      try {
        snapshot = await repository.load();
      } catch (error: unknown) {
        if (!cancelled) dispatch({ type: 'load-failed', message: errorMessage(error) });
        return;
      }
      if (cancelled) return;

      snapshotRef.current = snapshot;
      snapshotVersionRef.current += 1;
      dirtyVersionRef.current = null;
      dispatch({
        type: 'loaded',
        snapshot,
        warning: repository.consumeWarning()?.message ?? null,
      });

      if (!discoverCapabilities) return;
      try {
        const capabilities = await discoverCapabilities();
        if (cancelled || !snapshotRef.current) return;
        const next = {
          ...snapshotRef.current,
          providerCapabilities: {
            ...snapshotRef.current.providerCapabilities,
            ...capabilities,
          },
        };
        snapshotRef.current = next;
        snapshotVersionRef.current += 1;
        dispatch({ type: 'snapshot-updated', snapshot: next });
      } catch {
        // Capability discovery is optional and must not block the workbench.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [discoverCapabilities, repository]);

  const saveSnapshot = useCallback(
    (snapshot: WorkbenchSnapshot) => {
      snapshotRef.current = snapshot;
      snapshotVersionRef.current += 1;
      const version = snapshotVersionRef.current;
      dispatch({ type: 'snapshot-updated', snapshot });
      return enqueueSave(snapshot, version);
    },
    [enqueueSave],
  );

  const updateSnapshot = useCallback(
    (mutate: SnapshotMutator, options?: { persist?: boolean }) => {
      const base = snapshotRef.current;
      if (!base) return;
      const next = mutate(base);
      snapshotRef.current = next;
      snapshotVersionRef.current += 1;
      const version = snapshotVersionRef.current;
      dispatch({ type: 'snapshot-updated', snapshot: next });
      if (options?.persist) {
        void enqueueSave(next, version).catch(() => undefined);
      } else {
        dirtyVersionRef.current = version;
      }
    },
    [enqueueSave],
  );

  const flushPending = useCallback(async () => {
    const snapshot = snapshotRef.current;
    if (dirtyVersionRef.current !== null && snapshot) {
      const version = snapshotVersionRef.current;
      void enqueueSave(snapshot, version).catch(() => undefined);
    }
    await saveQueueRef.current;
  }, [enqueueSave]);

  const resetSnapshot = useCallback(async () => {
    dispatch({ type: 'save-begin' });
    try {
      await saveQueueRef.current;
      const snapshot = await repository.reset();
      snapshotRef.current = snapshot;
      snapshotVersionRef.current += 1;
      dirtyVersionRef.current = null;
      dispatch({ type: 'snapshot-updated', snapshot });
      dispatch({ type: 'save-succeeded' });
      return snapshot;
    } catch (error) {
      dispatch({ type: 'save-failed', message: errorMessage(error) });
      throw error;
    }
  }, [repository]);

  useEffect(() => {
    const interval = setInterval(() => {
      void flushPending();
    }, CLOSE_FLUSH_INTERVAL_MS);

    let unlisten: (() => void) | undefined;
    let disposed = false;
    const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    if (inTauri) {
      void (async () => {
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          const appWindow = getCurrentWindow();
          const stop = await appWindow.onCloseRequested(async (event) => {
            event.preventDefault();
            try {
              await flushPending();
            } finally {
              await appWindow.destroy();
            }
          });
          if (disposed) stop();
          else unlisten = stop;
        } catch {
          // Browser and test environments use the interval fallback only.
        }
      })();
    }

    return () => {
      disposed = true;
      clearInterval(interval);
      unlisten?.();
    };
  }, [flushPending]);

  const value = useMemo(
    () => ({
      ...state,
      warning: state.warning ? text(state.warning) : null,
      error: state.error ? text(state.error) : null,
      repository,
      resetSnapshot,
      saveSnapshot,
      updateSnapshot,
      flushPending,
    }),
    [flushPending, repository, resetSnapshot, saveSnapshot, state, text, updateSnapshot],
  );

  return <WorkbenchContext.Provider value={value}>{children}</WorkbenchContext.Provider>;
}

export function useWorkbench(): WorkbenchContextValue {
  const context = useContext(WorkbenchContext);
  if (!context) throw new Error('useWorkbench must be used within WorkbenchProvider.');
  return context;
}
