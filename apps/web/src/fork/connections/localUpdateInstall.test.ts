import type { DesktopBridge, DesktopUpdateState } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { setLocalInstallWhenIdle, supportsInstallWhenIdle } from "./localUpdateInstall";

describe("desktop idle-install command", () => {
  it("accepts arming only when desktop main confirms it and supports cancellation", async () => {
    const report = vi.fn();
    const command = vi.fn(
      async (armed: boolean) => ({ installWhenIdle: armed }) as DesktopUpdateState,
    );
    const bridge = { setInstallWhenIdle: command } as unknown as DesktopBridge;
    expect(supportsInstallWhenIdle(bridge)).toBe(true);
    expect(await setLocalInstallWhenIdle(bridge, true, report)).toBe(true);
    expect(await setLocalInstallWhenIdle(bridge, false, report)).toBe(true);
    command.mockResolvedValueOnce({} as DesktopUpdateState);
    expect(await setLocalInstallWhenIdle(bridge, true, report)).toBe(false);
    expect(report).toHaveBeenCalledWith(
      "Could not schedule the update",
      "The downloaded update is no longer ready to install.",
    );
  });
  it("reports unavailable or rejected IPC instead of promising an update", async () => {
    const report = vi.fn();
    const older = {} as DesktopBridge;
    expect(supportsInstallWhenIdle(older)).toBe(false);
    expect(await setLocalInstallWhenIdle(older, true, report)).toBe(false);
    const bridge = {
      setInstallWhenIdle: vi.fn().mockRejectedValue(new Error("IPC closed")),
    } as unknown as DesktopBridge;
    expect(await setLocalInstallWhenIdle(bridge, false, report)).toBe(false);
    expect(report).toHaveBeenLastCalledWith("Could not cancel the scheduled update", "IPC closed");
  });
});
