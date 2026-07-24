import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import type { WorkbenchSnapshot } from '../contracts/workbenchData';
import type { PrototypeRepository } from '../data/prototypeRepository';

type WorkbenchLoadState = 'loading' | 'ready' | 'error';

interface WorkbenchState {
  loadState: WorkbenchLoadState;
  snapshot: WorkbenchSnapshot | null;
  warning: string | null;
  error: string | null;
}

type WorkbenchAction =
  | { type: 'loaded'; snapshot: WorkbenchSnapshot; warning: string | null }
  | { type: 'failed'; message: string };

const initialState: WorkbenchState = {
  loadState: 'loading',
  snapshot: null,
  warning: null,
  error: null,
};

function reducer(state: WorkbenchState, action: WorkbenchAction): WorkbenchState {
  switch (action.type) {
    case 'loaded':
      return {
        loadState: 'ready',
        snapshot: action.snapshot,
        warning: action.warning,
        error: null,
      };
    case 'failed':
      return { ...state, loadState: 'error', error: action.message };
  }
}

interface WorkbenchContextValue extends WorkbenchState {
  repository: PrototypeRepository;
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

  const value = useMemo(() => ({ ...state, repository }), [repository, state]);
  return <WorkbenchContext.Provider value={value}>{children}</WorkbenchContext.Provider>;
}

export function useWorkbench(): WorkbenchContextValue {
  const context = useContext(WorkbenchContext);
  if (!context) throw new Error('useWorkbench must be used within WorkbenchProvider.');
  return context;
}
