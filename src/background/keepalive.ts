export interface KeepAliveOptions {
  /** How long to keep pinging after the last task settles. */
  lingerMs?: number;
  /** Called once pinging stops: no task ran for the whole linger window. */
  onIdle?: () => void;
}

export function createKeepAlive(
  ping: () => Promise<unknown>,
  intervalMs: number,
  { lingerMs = 0, onIdle }: KeepAliveOptions = {},
): <T>(task: () => Promise<T>) => Promise<T> {
  let activeTasks = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let lingerTimer: ReturnType<typeof setTimeout> | undefined;

  const keepAlive = () => {
    void ping().catch(() => {});
  };

  const stop = () => {
    lingerTimer = undefined;
    clearInterval(timer);
    timer = undefined;
    onIdle?.();
  };

  return async <T>(task: () => Promise<T>): Promise<T> => {
    activeTasks += 1;
    clearTimeout(lingerTimer);
    lingerTimer = undefined;
    if (timer === undefined) {
      keepAlive();
      timer = setInterval(keepAlive, intervalMs);
    }

    try {
      return await task();
    } finally {
      activeTasks -= 1;
      if (activeTasks === 0 && timer !== undefined) {
        if (lingerMs > 0) {
          lingerTimer = setTimeout(stop, lingerMs);
        } else {
          stop();
        }
      }
    }
  };
}
