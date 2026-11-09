/** Worker-owned master switch. A disable/re-enable cycle never admits old work. */
export function createWorkerAccess(extension: any) {
  let controller = new AbortController();
  extension.storage.onChanged?.addListener((changes: Record<string, unknown>, area: string) => {
    if (area === 'sync' && Object.prototype.hasOwnProperty.call(changes, 'enabled')) {
      controller.abort(); controller = new AbortController();
    }
  });
  return {
    signal: () => controller.signal,
    async allowed(signal: AbortSignal) {
      if (signal.aborted) return false;
      try {
        const state = await extension.storage.sync.get({ enabled: true });
        return state.enabled !== false && !signal.aborted;
      } catch { return false; }
    },
  };
}
export type WorkerAccess = ReturnType<typeof createWorkerAccess>;
