// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { type VaultTestAccount } from "@t3tools/contracts/fork";
import {
  vaultTestAccountActions,
  vaultTestAccountDeadlines,
  vaultTestAccountState,
} from "@t3tools/client-runtime/fork";
import { useVaultTime as useMobileClock } from "./useVaultTime";
const start = Date.parse("2026-10-20T00:00:00Z");
const account: VaultTestAccount = {
  id: "a".repeat(32),
  collectionId: "b".repeat(32),
  itemId: "c".repeat(32),
  itemVersion: 1,
  label: "Editor",
  role: "editor",
  state: "reserved",
  lease: { id: "d".repeat(32), owner: "client:one", createdAt: start, expiresAt: start + 300_000 },
};
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.setSystemTime(start);
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it.each([["mobile", useMobileClock]] as const)(
  "%s clock handles a delayed reservation, repeated renewal eligibility and expiry while mounted",
  (_surface, useClock) => {
    let observed: { now: number; state: string; actions: string[] } | null = null;
    function Probe({ value, checkedAt }: { value: VaultTestAccount | null; checkedAt: number }) {
      const now = useClock(vaultTestAccountDeadlines(value ? [value] : []), checkedAt);
      useLayoutEffect(() => {
        observed = value
          ? {
              now,
              state: vaultTestAccountState(value, now),
              actions: vaultTestAccountActions(value, "client:one", false, now).map(
                (a) => a.change.type,
              ),
            }
          : { now, state: "empty", actions: [] };
      });
      return null;
    }
    act(() => root.render(<Probe value={null} checkedAt={start} />));
    act(() => vi.advanceTimersByTime(720_000));
    const reservedAt = start + 720_000;
    const reserved = {
      ...account,
      lease: { ...account.lease!, createdAt: reservedAt, expiresAt: reservedAt + 300_000 },
    };
    act(() => root.render(<Probe value={reserved} checkedAt={reservedAt} />));
    expect(observed!.now).toBe(reservedAt);
    expect(observed!.actions).toContain("renew");
    const renewed = { ...reserved, lease: { ...reserved.lease, expiresAt: reservedAt + 900_000 } };
    act(() => root.render(<Probe value={renewed} checkedAt={reservedAt} />));
    expect(observed!.actions).not.toContain("renew");
    act(() => vi.advanceTimersByTime(2));
    expect(observed!.actions).toContain("renew");
    const nextRenewedAt = reservedAt + 2;
    const next = { ...renewed, lease: { ...renewed.lease, expiresAt: nextRenewedAt + 900_000 } };
    act(() => root.render(<Probe value={next} checkedAt={nextRenewedAt} />));
    expect(observed!.actions).not.toContain("renew");
    act(() => vi.advanceTimersByTime(2));
    expect(observed!.actions).toContain("renew");
    act(() => vi.advanceTimersByTime(900_000));
    expect(observed!.state).toBe("quarantined");
    expect(observed!.actions).toEqual(["mark-clean", "retire"]);
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("reschedules a deadline timer that fires before the wall clock reaches expiry", () => {
  let state = "";
  function Probe() {
    const now = useMobileClock(vaultTestAccountDeadlines([account]), start);
    useLayoutEffect(() => {
      state = vaultTestAccountState(account, now);
    });
    return null;
  }
  act(() => root.render(<Probe />));
  const clock = vi.spyOn(Date, "now").mockReturnValue(start);
  act(() => vi.advanceTimersByTime(300_001));
  expect(state).toBe("reserved");
  expect(vi.getTimerCount()).toBe(1);
  clock.mockRestore();
  act(() => vi.advanceTimersByTime(300_001));
  expect(state).toBe("quarantined");
  expect(vi.getTimerCount()).toBe(0);
});
