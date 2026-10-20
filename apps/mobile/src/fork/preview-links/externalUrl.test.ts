import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { requestPreviewEntryUrl } from "./entryUrl";
import { previewLinkOpenUrl } from "./externalUrl";

vi.mock("./entryUrl", () => ({ requestPreviewEntryUrl: vi.fn() }));

const lookup = vi.mocked(requestPreviewEntryUrl);
const LINK = "https://5173-k3f9x2-dorothy.bagels.top/app?x=1";
const ENTRY = "https://5173-k3f9x2-dorothy.bagels.top/__loom/enter?code=abc";

beforeEach(() => {
  lookup.mockReset();
});

describe("previewLinkOpenUrl", () => {
  it("swaps a preview link for an entry link from the computer that serves it", async () => {
    lookup.mockResolvedValue(ENTRY);
    await expect(previewLinkOpenUrl(LINK)).resolves.toBe(ENTRY);
    expect(lookup).toHaveBeenCalledWith(LINK);
  });

  it("opens the link as is when no connected computer serves it", async () => {
    lookup.mockResolvedValue(null);
    await expect(previewLinkOpenUrl(LINK)).resolves.toBe(LINK);
  });

  it.each([
    ["an entry link, which would otherwise be traded for another", ENTRY],
    ["any other URL", "https://github.com/pingdotgg/t3code"],
  ])("leaves %s alone", async (_, url) => {
    await expect(previewLinkOpenUrl(url)).resolves.toBe(url);
    expect(lookup).not.toHaveBeenCalled();
  });
});
