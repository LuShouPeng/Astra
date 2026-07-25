import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';
import type { AgentProvider, ProviderCapability } from '../contracts/agents';
import type { WorkbenchSnapshot } from '../contracts/workbenchData';
import type { PrototypeRepository } from '../data/prototypeRepository';

export type CapabilityDiscovery = () => Promise<Partial<Record<AgentProvider, ProviderCapability>>>;

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
  | { type: 'failed'; message: string }
  | { type: 'saving' }
  | { type: 'saved'; snapshot: WorkbenchSnapshot }
  | { type: 'capabilities'; capabilities: Partial<Record<AgentProvider, ProviderCapability>> };

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
    case 'failed':
      return { ...state, loadState: 'error', error: action.message, saving: false };
    case 'saving':
      return { ...state, saving: true, error: null };
    case 'saved':
      return { ...state, snapshot: action.snapshot, saving: false };
    case 'capabilities':
      if (!state.snapshot) return state;
      return {
        ...state,
        snapshot: {
          ...state.snapshot,
          providerCapabilities: {
            ...state.snapshot.providerCapabilities,
            ...action.capabilities,
          },
        },
      };
  }
}

interface WorkbenchContextValue extends WorkbenchState {
  repository: PrototypeRepository;
  saveSnapshot: (snapshot: WorkbenchSnapshot) => Promise<void>;
  resetSnapshot: () => Promise<WorkbenchSnapshot>;
}

const WorkbenchContext = createContext<WorkbenchContextValue | null>(null);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Workbench data could not be loaded.';
}

export function WorkbenchProvider({
  children,
  repository,
  discoverCapabilities,
}: {
  children: ReactNode;
  repository: PrototypeRepository;
  discoverCapabilities?: CapabilityDiscovery;
}) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let snapshot: WorkbenchSnapshot;
      try {
        snapshot = await repository.load();
      } catch (error: unknown) {
        if (!cancelled) dispatch({ type: 'failed', message: errorMessage(error) });
        return;
      }
      if (cancelled) return;
      dispatch({
        type: 'loaded',
        snapshot,
        warning: repository.consumeWarning()?.message ?? null,
      });
      // 加载后追加一次能力探测；结果只更新内存快照，不落盘。
      // 探测失败（CLI 未装 / 非 Tauri 环境）静默降级，保留现有能力值。
      if (!discoverCapabilities) return;
      try {
        const capabilities = await discoverCapabilities();
        if (!cancelled) dispatch({ type: 'capabilities', capabilities });
      } catch {
        /* 非致命：保留 demo 能力值 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repository, discoverCapabilities]);

  const saveSnapshot = useCallback(
    async (snapshot: WorkbenchSnapshot) => {
      dispatch({ type: 'saving' });
      try {
        await repository.save(snapshot);
        dispatch({ type: 'saved', snapshot });
      } catch (error) {
        dispatch({ type: 'failed', message: errorMessage(error) });
        throw error;
      }
    },
    [repository],
  );

  const resetSnapshot = useCallback(async () => {
    dispatch({ type: 'saving' });
    try {
      const snapshot = await repository.reset();
      dispatch({ type: 'saved', snapshot });
      return snapshot;
    } catch (error) {
      dispatch({ type: 'failed', message: errorMessage(error) });
      throw error;
    }
  }, [repository]);

  const value = useMemo(
    () => ({ ...state, repository, resetSnapshot, saveSnapshot }),
    [repository, resetSnapshot, saveSnapshot, state],
  );
  return <WorkbenchContext.Provider value={value}>{children}</WorkbenchContext.Provider>;
}

export function useWorkbench(): WorkbenchContextValue {
  const context = useContext(WorkbenchContext);
  if (!context) throw new Error('useWorkbench must be used within WorkbenchProvider.');
  return context;
}
