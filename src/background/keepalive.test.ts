import { afterEach, describe, expect, it, vi } from "vitest";
import { createKeepAlive } from "./keepalive";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("createKeepAlive", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pings while a task is active and stops when it settles", async () => {
    vi.useFakeTimers();
    const ping = vi.fn(async () => {});
    const task = deferred<string>();
    const runWithKeepAlive = createKeepAlive(ping, 20_000);

    const result = runWithKeepAlive(() => task.promise);
    expect(ping).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(ping).toHaveBeenCalledTimes(2);

    task.resolve("done");
    await expect(result).resolves.toBe("done");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(ping).toHaveBeenCalledTimes(2);
  });

  it("stays active until every concurrent task settles", async () => {
    vi.useFakeTimers();
    const ping = vi.fn(async () => {});
    const first = deferred<void>();
    const second = deferred<void>();
    const runWithKeepAlive = createKeepAlive(ping, 20_000);

    const firstResult = runWithKeepAlive(() => first.promise);
    const secondResult = runWithKeepAlive(() => second.promise);

    first.resolve();
    await firstResult;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(ping).toHaveBeenCalledTimes(2);

    second.resolve();
    await secondResult;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(ping).toHaveBeenCalledTimes(2);
  });

  it("keeps pinging for the linger window, then reports idle", async () => {
    vi.useFakeTimers();
    const ping = vi.fn(async () => {});
    const onIdle = vi.fn();
    const runWithKeepAlive = createKeepAlive(ping, 20_000, {
      lingerMs: 60_000,
      onIdle,
    });

    await runWithKeepAlive(async () => {});
    await vi.advanceTimersByTimeAsync(59_999);
    expect(ping).toHaveBeenCalledTimes(3);
    expect(onIdle).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(onIdle).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ping).toHaveBeenCalledTimes(4);
  });

  it("restarts the linger window when a new task runs inside it", async () => {
    vi.useFakeTimers();
    const ping = vi.fn(async () => {});
    const onIdle = vi.fn();
    const runWithKeepAlive = createKeepAlive(ping, 20_000, {
      lingerMs: 60_000,
      onIdle,
    });

    await runWithKeepAlive(async () => {});
    await vi.advanceTimersByTimeAsync(50_000);
    await runWithKeepAlive(async () => {});
    await vi.advanceTimersByTimeAsync(50_000);
    expect(onIdle).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(onIdle).toHaveBeenCalledOnce();
  });

  it("does not report idle while a task outlasts the linger window", async () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const task = deferred<void>();
    const runWithKeepAlive = createKeepAlive(async () => {}, 20_000, {
      lingerMs: 60_000,
      onIdle,
    });

    const result = runWithKeepAlive(() => task.promise);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(onIdle).not.toHaveBeenCalled();

    task.resolve();
    await result;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onIdle).toHaveBeenCalledOnce();
  });
});
