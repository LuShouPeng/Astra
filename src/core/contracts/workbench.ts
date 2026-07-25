import type { ComponentType, LazyExoticComponent } from 'react';
import type { ActiveWorkspace } from './workspace';

export type ModuleId = 'workspace' | 'agents' | 'sessions' | 'changes';

export interface WorkbenchContext {
  workspace: ActiveWorkspace;
}

export interface WorkbenchModule {
  id: ModuleId;
  title: string;
  order: number;
  icon: ComponentType<{ size?: number }>;
  sidebar: LazyExoticComponent<ComponentType>;
  main: LazyExoticComponent<ComponentType>;
  isEnabled(ctx: WorkbenchContext): boolean;
}
