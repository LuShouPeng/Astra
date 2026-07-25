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

export type CapabilityDiscovery = () => Promise<Partial<Record<AgentProvider, ProviderCapability>>>;

/** 就地修改快照的纯函数：接收当前快照，返回新快照（不得原地变更入参）。 */
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
  | { type: 'save-failed'; message: string }
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
    case 'load-failed':
      return { ...state, loadState: 'error', error: action.message, saving: false };
    // 内存快照推进：由用户操作或高频 live 事件驱动，不改动落盘状态。
    case 'snapshot-updated':
      return { ...state, snapshot: action.snapshot };
    case 'save-begin':
      return { ...state, saving: true, error: null };
    // 落盘成功仅清除 saving 标志：显示快照始终由 snapshot-updated 推进，
    // 若在此覆盖 state.snapshot 会把并发的内存更新回退到旧值 [C2]。
    case 'save-succeeded':
      return { ...state, saving: false };
    // 后台落盘失败保留 loadState，仅记录错误，避免整屏跌回 error [C2]。
    case 'save-failed':
      return { ...state, saving: false, error: action.message };
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
  /** 整体替换并落盘（用户级操作，如新增项目）。返回落盘 Promise。 */
  saveSnapshot: (snapshot: WorkbenchSnapshot) => Promise<void>;
  /**
   * 基于最新快照就地更新。`persist:true` 关键节点落盘；否则仅更新内存并标脏，
   * 由定时兜底 / 关闭钩子统一落盘 [C2]。适合高频 live 流事件。
   */
  updateSnapshot: (mutate: SnapshotMutator, options?: { persist?: boolean }) => void;
  /** 等待所有待落盘写入完成（关闭前调用）[B1]。 */
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
  const [state, dispatch] = useReducer(reducer, initialState);
  // 最新快照的同步镜像：React state 异步，高频 updateSnapshot 若读闭包会取到旧值。
  const snapshotRef = useRef<WorkbenchSnapshot | null>(null);
  // 落盘队列尾：所有写入串行化，防定时兜底与用户操作并发覆盖 [C2]。
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  // 存在未落盘的内存更新（persist:false）时置真，供定时兜底与关闭钩子决定是否写盘。
  const dirtyRef = useRef(false);

  const enqueueSave = useCallback(
    (snapshot: WorkbenchSnapshot): Promise<void> => {
      const attempt = saveQueueRef.current
        .catch(() => undefined) // 隔离上一次失败，保证队列继续推进。
        .then(async () => {
          dispatch({ type: 'save-begin' });
          try {
            await repository.save(snapshot);
            dirtyRef.current = false;
            dispatch({ type: 'save-succeeded' });
          } catch (error) {
            dispatch({ type: 'save-failed', message: errorMessage(error) });
            throw error;
          }
        });
      // 队列尾吞掉 rejection 以免断链；返回的 Promise 仍向调用方透出失败。
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
        if (cancelled) return;
        dispatch({ type: 'capabilities', capabilities });
        if (snapshotRef.current) {
          snapshotRef.current = {
            ...snapshotRef.current,
            providerCapabilities: {
              ...snapshotRef.current.providerCapabilities,
              ...capabilities,
            },
          };
        }
      } catch {
        /* 非致命：保留 demo 能力值 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repository, discoverCapabilities]);

  const saveSnapshot = useCallback(
    (snapshot: WorkbenchSnapshot) => {
      snapshotRef.current = snapshot;
      dispatch({ type: 'snapshot-updated', snapshot });
      return enqueueSave(snapshot);
    },
    [enqueueSave],
  );

  const updateSnapshot = useCallback(
    (mutate: SnapshotMutator, options?: { persist?: boolean }) => {
      const base = snapshotRef.current;
      if (!base) return;
      const next = mutate(base);
      snapshotRef.current = next;
      dispatch({ type: 'snapshot-updated', snapshot: next });
      if (options?.persist) {
        // 关键节点：入队落盘。失败已由 save-failed 记录，此处 fire-and-forget。
        void enqueueSave(next).catch(() => undefined);
      } else {
        dirtyRef.current = true;
      }
    },
    [enqueueSave],
  );

  const flushPending = useCallback(async () => {
    if (dirtyRef.current && snapshotRef.current) {
      void enqueueSave(snapshotRef.current).catch(() => undefined);
    }
    await saveQueueRef.current;
  }, [enqueueSave]);

  const resetSnapshot = useCallback(async () => {
    dispatch({ type: 'save-begin' });
    try {
      const snapshot = await repository.reset();
      snapshotRef.current = snapshot;
      dirtyRef.current = false;
      dispatch({ type: 'snapshot-updated', snapshot });
      dispatch({ type: 'save-succeeded' });
      return snapshot;
    } catch (error) {
      dispatch({ type: 'save-failed', message: errorMessage(error) });
      throw error;
    }
  }, [repository]);

  // [B1] 关闭前落盘 + 定时兜底。onCloseRequested 在非 Tauri 环境静默跳过。
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
            // 阻塞关闭，落盘完成后再销毁窗口，避免运行中会话丢失最后一批写入。
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
          /* 非 Tauri / window API 缺失：忽略，仅保留定时兜底 */
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
      repository,
      resetSnapshot,
      saveSnapshot,
      updateSnapshot,
      flushPending,
    }),
    [flushPending, repository, resetSnapshot, saveSnapshot, state, updateSnapshot],
  );
  return <WorkbenchContext.Provider value={value}>{children}</WorkbenchContext.Provider>;
}

export function useWorkbench(): WorkbenchContextValue {
  const context = useContext(WorkbenchContext);
  if (!context) throw new Error('useWorkbench must be used within WorkbenchProvider.');
  return context;
}
