import { Suspense, type LazyExoticComponent, type ComponentType } from 'react';

export function MainSlot({
  component: Component,
}: {
  component: LazyExoticComponent<ComponentType>;
}) {
  return (
    <section className="main-slot">
      <Suspense fallback={<div className="slot-loading" />}>
        <Component />
      </Suspense>
    </section>
  );
}
