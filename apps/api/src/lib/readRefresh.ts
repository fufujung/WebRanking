/**
 * When reads may refresh a tournament's derived data (prediction markets): at most one refresh per key is
 * in flight, the "last refreshed" time only moves when a refresh really finished, and a failed refresh is
 * tried again by the next read. The refresh itself is passed in, so this is tested without a database.
 */
export function makeReadRefresh(opts: {
  /** Does the work. Runs inside the caller's own queue (`schedule`), never two at once for one key. */
  refresh: (key: string) => Promise<void>;
  /** The queue writes go through (prediction coin moves run one at a time). */
  schedule: <T>(fn: () => Promise<T>) => Promise<T>;
  /** How old a successful refresh may be before a read starts another one. */
  maxAgeMs: number;
  now?: () => number;
  onBackgroundError?: (key: string, err: unknown) => void;
}) {
  const now = opts.now ?? Date.now;
  const lastSuccess = new Map<string, number>();
  const inFlight = new Map<string, Promise<void>>();
  const fresh = (key: string) => {
    const t = lastSuccess.get(key);
    return t !== undefined && now() - t < opts.maxAgeMs;
  };

  /** Runs a refresh now (after whatever is queued) and records when it succeeded. */
  async function run(key: string) {
    await opts.refresh(key);
    lastSuccess.set(key, now());
  }

  function start(key: string) {
    let p = inFlight.get(key);
    if (!p) {
      p = opts.schedule(() => (fresh(key) ? Promise.resolve() : run(key))).finally(() => inFlight.delete(key));
      inFlight.set(key, p);
    }
    return p;
  }

  return {
    /** For an explicit change (a bracket write): always refreshes, queued behind earlier work. */
    now: (key: string) => opts.schedule(() => run(key)),
    /**
     * For reads. Fresh: nothing to do. Never refreshed in this process: wait for the first refresh.
     * Stale: answer from what is stored and refresh in the background (one refresh, however many readers).
     */
    forRead(key: string): Promise<void> {
      if (fresh(key)) return Promise.resolve();
      const p = start(key);
      if (!lastSuccess.has(key)) return p;
      p.catch((err) => opts.onBackgroundError?.(key, err));
      return Promise.resolve();
    },
    lastSuccess: (key: string) => lastSuccess.get(key),
    inFlight: (key: string) => inFlight.has(key),
  };
}
