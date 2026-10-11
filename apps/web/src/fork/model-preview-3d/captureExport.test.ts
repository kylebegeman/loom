import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { canCopyImages, captureFileName, copyImage, saveImage } from "./captureExport";

const write = vi.fn(async (_items: ClipboardItem[]) => undefined);
class TestClipboardItem {
  static supports = vi.fn(() => true);
  constructor(readonly data: Record<string, Promise<Blob>>) {}
}
beforeEach(() => {
  write.mockReset().mockResolvedValue(undefined);
  TestClipboardItem.supports.mockReset().mockReturnValue(true);
  vi.stubGlobal("window", { isSecureContext: true });
  vi.stubGlobal("navigator", { clipboard: { write } });
  vi.stubGlobal("ClipboardItem", TestClipboardItem);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("names downloads with safe model/view names and padded local time", () => {
  const date = new Date(2026, 0, 5, 9, 7);
  expect(captureFileName("models/Bracket.scad", "Front", date)).toBe(
    "Bracket-Front-20260105-0907.png",
  );
  expect(captureFileName("models\\Box part.3mf", "left / side?", date)).toBe(
    "Box-part-left-side-20260105-0907.png",
  );
  expect(captureFileName("boards/Controller.kicad_pcb", "schematic-power", date, "svg")).toBe(
    "Controller-schematic-power-20260105-0907.svg",
  );
  expect(captureFileName("", "", date)).toBe("model-view-20260105-0907.png");
  expect(captureFileName("模型.stl", "前面", date)).toBe("model-view-20260105-0907.png");
  expect(captureFileName(`${"a".repeat(100)}.glb`, "top", date)).toBe(
    `${"a".repeat(80)}-top-20260105-0907.png`,
  );
});
it("allows image copying only on a secure connection with PNG clipboard support", () => {
  expect(canCopyImages()).toBe(true);
  vi.stubGlobal("window", { isSecureContext: false });
  expect(canCopyImages()).toBe(false);
  vi.stubGlobal("window", { isSecureContext: true });
  vi.stubGlobal("navigator", { clipboard: {} });
  expect(canCopyImages()).toBe(false);
  vi.stubGlobal("navigator", { clipboard: { write } });
  vi.stubGlobal("ClipboardItem", undefined);
  expect(canCopyImages()).toBe(false);
  vi.stubGlobal("ClipboardItem", TestClipboardItem);
  TestClipboardItem.supports.mockReturnValue(false);
  expect(canCopyImages()).toBe(false);
  vi.stubGlobal(
    "ClipboardItem",
    class {
      readonly types = ["image/png"];
    },
  );
  expect(canCopyImages()).toBe(true);
});
it("starts the clipboard write synchronously while rendering is still pending", async () => {
  let resolve!: (blob: Blob) => void;
  const image = new Promise<Blob>((done) => {
    resolve = done;
  });
  const copied = copyImage(image);
  expect(write).toHaveBeenCalledOnce();
  const item = write.mock.calls[0]![0][0] as unknown as TestClipboardItem;
  expect(item.data["image/png"]).toBe(image);
  const png = new Blob(["full PNG"], { type: "image/png" });
  resolve(png);
  expect(await item.data["image/png"]).toBe(png);
  await copied;
});
it("explains unavailable copying and preserves clipboard errors", async () => {
  vi.stubGlobal("window", { isSecureContext: false });
  expect(() => copyImage(Promise.resolve(new Blob()))).toThrow(
    "Image copying is unavailable. Use a secure browser connection or save the image.",
  );
  expect(write).not.toHaveBeenCalled();
  vi.stubGlobal("window", { isSecureContext: true });
  write.mockRejectedValueOnce(new Error("Clipboard denied"));
  await expect(copyImage(Promise.resolve(new Blob()))).rejects.toThrow("Clipboard denied");
});
it("downloads the original blob and revokes its URL after the browser receives it", () => {
  vi.useFakeTimers();
  const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:capture");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const anchor = { href: "", download: "", click: vi.fn() };
  vi.stubGlobal("document", { createElement: () => anchor });
  const image = new Blob(["full PNG bytes"], { type: "image/png" });
  saveImage(image, "part-front.png");
  expect(createUrl).toHaveBeenCalledWith(image);
  expect(anchor).toMatchObject({ href: "blob:capture", download: "part-front.png" });
  expect(anchor.click).toHaveBeenCalledOnce();
  expect(revoke).not.toHaveBeenCalled();
  vi.advanceTimersByTime(30_000);
  expect(revoke).toHaveBeenCalledWith("blob:capture");
});
it("releases the download URL even when starting the download fails", () => {
  vi.useFakeTimers();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:failed");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.stubGlobal("document", {
    createElement: () => ({
      click: () => {
        throw new Error("Download blocked");
      },
    }),
  });
  expect(() => saveImage(new Blob(), "part.png")).toThrow("Download blocked");
  vi.advanceTimersByTime(30_000);
  expect(revoke).toHaveBeenCalledWith("blob:failed");
});
