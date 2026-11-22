import { useCallback, useEffect, useRef } from "react";

// A repeating async check that stops itself on unmount. `start` replaces any
// poll already running; `stop` ends it. A tick that throws is treated as a
// transient failure and polling carries on — a tick that wants to stop calls
// `stop()` itself.
export function usePoller() {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);

  const start = useCallback(
    (tick: () => Promise<void> | void, intervalMs: number) => {
      stop();
      timer.current = setInterval(() => {
        Promise.resolve()
          .then(tick)
          .catch(() => {});
      }, intervalMs);
    },
    [stop]
  );

  useEffect(() => stop, [stop]);

  return { start, stop };
}
