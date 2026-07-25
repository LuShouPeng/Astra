import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';
import type {
  ActiveWorkspace,
  WorkspaceId,
  WorkspaceRecord,
  WorkspaceService,
} from '../../../core/contracts/workspace';
import { appEventBus } from '../../../core/events/appEventBus';
import { useI18n } from '../../../core/i18n/I18nContext';
import type { WorkspaceServiceController } from '../services/workspaceService';

type LoadState = 'loading' | 'ready';
type PendingAction = 'choose' | `open:${string}` | `remove:${string}` | null;

interface WorkspaceState {
  loadState: LoadState;
  workspaces: WorkspaceRecord[];
  activeWorkspace: ActiveWorkspace | null;
  selectedId: WorkspaceId | null;
  pendingAction: PendingAction;
  warning: string | null;
  error: string | null;
}

type WorkspaceAction =
  | { type: 'loaded'; workspaces: WorkspaceRecord[]; warning: string | null }
  | { type: 'select'; id: WorkspaceId | null }
  | { type: 'pending'; action: PendingAction }
  | { type: 'updated'; workspaces: WorkspaceRecord[] }
  | { type: 'opened'; workspace: ActiveWorkspace; workspaces: WorkspaceRecord[] }
  | { type: 'closed' }
  | { type: 'error'; message: string; workspaces?: WorkspaceRecord[] }
  | { type: 'dismiss-message' };

const initialState: WorkspaceState = {
  loadState: 'loading',
  workspaces: [],
  activeWorkspace: null,
  selectedId: null,
  pendingAction: null,
  warning: null,
  error: null,
};

function reducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'loaded':
      return {
        ...state,
        loadState: 'ready',
        workspaces: action.workspaces,
        warning: action.warning,
      };
    case 'select':
      return { ...state, selectedId: action.id };
    case 'pending':
      return { ...state, pendingAction: action.action, error: null };
    case 'updated':
      return { ...state, workspaces: action.workspaces, pendingAction: null };
    case 'opened':
      return {
        ...state,
        activeWorkspace: action.workspace,
        workspaces: action.workspaces,
        selectedId: action.workspace.id,
        pendingAction: null,
      };
    case 'closed':
      return { ...state, activeWorkspace: null, pendingAction: null };
    case 'error':
      return {
        ...state,
        loadState: 'ready',
        error: action.message,
        workspaces: action.workspaces ?? state.workspaces,
        pendingAction: null,
      };
    case 'dismiss-message':
      return { ...state, error: null, warning: null };
  }
}

interface WorkspaceContextValue extends WorkspaceState {
  chooseAndOpen: () => Promise<WorkspaceRecord | null>;
  openRecent: (id: WorkspaceId) => Promise<void>;
  removeRecent: (id: WorkspaceId) => Promise<void>;
  selectWorkspace: (id: WorkspaceId | null) => void;
  closeWorkspace: () => void;
  dismissMessage: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'The workspace operation could not be completed.';
}

function warningFrom(service: WorkspaceService): string | null {
  const controller = service as Partial<WorkspaceServiceController>;
  return controller.consumeWarning?.()?.message ?? null;
}

export function WorkspaceProvider({
  children,
  service,
}: {
  children: ReactNode;
  service: WorkspaceService;
}) {
  const { text } = useI18n();
  const [state, dispatch] = useReducer(reducer, initialState);

  const reload = useCallback(async () => service.list(), [service]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await service.refreshAvailability();
        const workspaces = await reload();
        if (!cancelled) dispatch({ type: 'loaded', workspaces, warning: warningFrom(service) });
      } catch (error) {
        if (!cancelled) dispatch({ type: 'error', message: errorMessage(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reload, service]);

  const chooseAndOpen = useCallback(async () => {
    if (state.pendingAction) return null;
    dispatch({ type: 'pending', action: 'choose' });
    try {
      const record = await service.chooseAndAdd();
      if (!record) {
        dispatch({ type: 'updated', workspaces: await reload() });
        return null;
      }
      const workspace = { id: record.id, name: record.name, rootPath: record.rootPath };
      const workspaces = await reload();
      dispatch({ type: 'opened', workspace, workspaces });
      appEventBus.emit('workspace:opened', workspace);
      return record;
    } catch (error) {
      dispatch({ type: 'error', message: errorMessage(error), workspaces: await reload() });
      return null;
    }
  }, [reload, service, state.pendingAction]);

  const openRecent = useCallback(
    async (id: WorkspaceId) => {
      if (state.pendingAction) return;
      dispatch({ type: 'pending', action: `open:${id}` });
      try {
        const workspace = await service.open(id);
        const workspaces = await reload();
        dispatch({ type: 'opened', workspace, workspaces });
        appEventBus.emit('workspace:opened', workspace);
      } catch (error) {
        dispatch({ type: 'error', message: errorMessage(error), workspaces: await reload() });
      }
    },
    [reload, service, state.pendingAction],
  );

  const removeRecent = useCallback(
    async (id: WorkspaceId) => {
      if (state.pendingAction) return;
      dispatch({ type: 'pending', action: `remove:${id}` });
      try {
        await service.removeRecent(id);
        dispatch({ type: 'updated', workspaces: await reload() });
      } catch (error) {
        dispatch({ type: 'error', message: errorMessage(error), workspaces: await reload() });
      }
    },
    [reload, service, state.pendingAction],
  );

  const closeWorkspace = useCallback(() => {
    if (state.activeWorkspace) {
      appEventBus.emit('workspace:closed', { workspaceId: state.activeWorkspace.id });
    }
    dispatch({ type: 'closed' });
  }, [state.activeWorkspace]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      ...state,
      warning: state.warning ? text(state.warning) : null,
      error: state.error ? text(state.error) : null,
      chooseAndOpen,
      openRecent,
      removeRecent,
      selectWorkspace: (id) => dispatch({ type: 'select', id }),
      closeWorkspace,
      dismissMessage: () => dispatch({ type: 'dismiss-message' }),
    }),
    [chooseAndOpen, closeWorkspace, openRecent, removeRecent, state, text],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used within WorkspaceProvider.');
  return value;
}
