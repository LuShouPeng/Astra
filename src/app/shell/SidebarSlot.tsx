import { Suspense, type LazyExoticComponent, type ComponentType } from 'react';

export function SidebarSlot({
  component: Component,
}: {
  component: LazyExoticComponent<ComponentType>;
}) {
  return (
    <aside className="sidebar-slot">
      <Suspense fallback={<div className="slot-loading" />}>
        <Component />
      </Suspense>
    </aside>
  );
}
