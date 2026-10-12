import { afterEach, expect, it, vi } from "vite-plus/test";
import { deliverDesktopNotification } from "./notificationDelivery";

afterEach(() => vi.unstubAllGlobals());
it("serializes window claims and saves only identities after successful delivery", async () => {
  const storage = new Map<string, string>();
  const jobs: Promise<unknown>[] = [];
  let queue = Promise.resolve<unknown>(undefined);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal("navigator", {
    locks: {
      request: (_name: string, callback: () => unknown) => {
        const next = queue.then(callback);
        queue = next;
        jobs.push(next);
        return next;
      },
    },
  });
  const present = vi.fn(() => true);
  deliverDesktopNotification("environment:thread:approval", present);
  deliverDesktopNotification("environment:thread:approval", present);
  await Promise.all(jobs);
  expect(present).toHaveBeenCalledOnce();
  expect([...storage.values()]).toEqual(['["environment:thread:approval"]']);
  const rejected = vi.fn(() => false);
  deliverDesktopNotification("cancelled", rejected);
  await Promise.all(jobs);
  expect([...storage.values()]).toEqual(['["environment:thread:approval"]']);
});

it("still presents when browser storage is unavailable or unreadable", async () => {
  const jobs: Promise<unknown>[] = [];
  vi.stubGlobal("navigator", {
    locks: {
      request: (_name: string, callback: () => unknown) => {
        const next = Promise.resolve().then(callback);
        jobs.push(next);
        return next;
      },
    },
  });
  const present = vi.fn(() => true);
  vi.stubGlobal("localStorage", {
    getItem: () => "{not json",
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  });
  deliverDesktopNotification("environment:thread:corrupt", present);
  await Promise.all(jobs);
  expect(present).toHaveBeenCalledOnce();
  vi.stubGlobal("localStorage", undefined);
  deliverDesktopNotification("environment:thread:missing", present);
  await Promise.all(jobs);
  expect(present).toHaveBeenCalledTimes(2);
});
