import type { WorkbenchContext, WorkbenchModule } from '../contracts/workbench';
import { manifest as workspaceManifest } from '../../modules/workspace';

export const moduleRegistry: readonly WorkbenchModule[] = [workspaceManifest].sort(
  (left, right) => left.order - right.order,
);

export function getEnabledModules(context: WorkbenchContext): readonly WorkbenchModule[] {
  return moduleRegistry.filter((module) => module.isEnabled(context));
}
