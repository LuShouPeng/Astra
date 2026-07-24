import { createPrototypeRepository } from '../../core/data/prototypeRepository';
import { createDemoSnapshot } from '../../modules/demo';

export function createAcceptancePrototypeRepository() {
  return createPrototypeRepository({
    store: {
      load: () => Promise.resolve(null),
      save: () => Promise.resolve(),
    },
    createFallback: createDemoSnapshot,
  });
}
