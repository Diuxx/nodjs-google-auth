// Sérialise les écritures d'un même document au sein d'un seul processus.
export function createKeyedMutex() {
  const pending = new Map();
  return {
    async run(key, operation) {
      const previous = pending.get(key) || Promise.resolve();
      let release;
      const next = new Promise(resolve => { release = resolve; });
      pending.set(key, next);
      await previous;
      try {
        return await operation();
      } finally {
        release();
        if (pending.get(key) === next) pending.delete(key);
      }
    }
  };
}
