import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';
import type { WorkbenchSnapshot } from '../contracts/workbenchData';
import type { PrototypeRepository } from '../data/prototypeRepository';
import { useI18n } from '../i18n/I18nContext';

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
  | { type: 'saved'; snapshot: WorkbenchSnapshot };

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
}: {
  children: ReactNode;
  repository: PrototypeRepository;
}) {
  const { text } = useI18n();
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    let cancelled = false;
    void repository
      .load()
      .then((snapshot) => {
        if (cancelled) return;
        dispatch({
          type: 'loaded',
          snapshot,
          warning: repository.consumeWarning()?.message ?? null,
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) dispatch({ type: 'failed', message: errorMessage(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [repository]);

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
    () => ({
      ...state,
      warning: state.warning ? text(state.warning) : null,
      error: state.error ? text(state.error) : null,
      repository,
      resetSnapshot,
      saveSnapshot,
    }),
    [repository, resetSnapshot, saveSnapshot, state, text],
  );
  return <WorkbenchContext.Provider value={value}>{children}</WorkbenchContext.Provider>;
}

export function useWorkbench(): WorkbenchContextValue {
  const context = useContext(WorkbenchContext);
  if (!context) throw new Error('useWorkbench must be used within WorkbenchProvider.');
  return context;
}
