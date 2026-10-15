// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ write: vi.fn(), toast: vi.fn() }));
vi.mock("~/components/ui/toast", () => ({ toastManager: { add: mocks.toast } }));
vi.mock("~/hooks/useCopyToClipboard", () => ({ writeTextToClipboard: mocks.write }));

import { copyText, copyValue } from "./copyValue";

afterEach(() => {
  vi.clearAllMocks();
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
});

it("copies the shown value without digit grouping", () => {
  expect(copyText("1,234.5 mm")).toBe("1234.5 mm");
  expect(copyText("1,234,567.25 mm / 2,000 mm")).toBe("1234567.25 mm / 2000 mm");
  expect(copyText("12.35 mm, 0.5 in")).toBe("12.35 mm, 0.5 in");
});

it("copies a shown minus sign as an ASCII hyphen", () => {
  expect(copyText("\u22121,234.5 mm")).toBe("-1234.5 mm");
  expect(copyText("+2.0 mm")).toBe("+2.0 mm");
});

it("confirms a successful copy with the copied text", async () => {
  mocks.write.mockResolvedValueOnce(true);
  await copyValue("1,234.5 mm");
  expect(mocks.write).toHaveBeenCalledWith("1234.5 mm", "value");
  expect(mocks.toast).toHaveBeenCalledWith({ type: "success", title: "Copied 1234.5 mm" });
});

it("selects the value for a manual copy when the host blocks the clipboard", async () => {
  mocks.write.mockRejectedValueOnce(new Error("Denied"));
  const shown = document.createElement("span");
  shown.textContent = "42.50 mm";
  document.body.append(shown);
  await copyValue("42.50 mm", shown);
  expect(window.getSelection()?.toString()).toBe("42.50 mm");
  expect(mocks.toast).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "warning",
      description: "The value is selected; press Cmd or Ctrl+C.",
    }),
  );
});

it("shows the value when the host blocks the clipboard and nothing on screen can be selected", async () => {
  mocks.write.mockRejectedValueOnce(new Error("Denied"));
  await copyValue("X 1,204.5 mm, Y 3 mm");
  expect(window.getSelection()?.toString()).toBe("");
  expect(mocks.toast).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "warning",
      description: "Copy it by hand: X 1204.5 mm, Y 3 mm",
    }),
  );
});
