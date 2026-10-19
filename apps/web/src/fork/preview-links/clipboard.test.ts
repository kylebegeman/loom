import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { writePendingLinkToClipboard } from "./clipboard";

const LINK = "https://5797-k3f9x2-dorothy.bagels.top/";

class FakeClipboardItem {
  constructor(readonly data: Record<string, Promise<Blob>>) {}
}

function stubClipboard(write: (items: Array<FakeClipboardItem>) => Promise<void>) {
  const clipboard = { write: vi.fn(write), writeText: vi.fn(async (_text: string) => undefined) };
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", { clipboard });
  vi.stubGlobal("ClipboardItem", FakeClipboardItem);
  return clipboard;
}

// Like a browser, the write settles only once the item's pending text does.
const readItems = async (items: Array<FakeClipboardItem>) => {
  await items[0]!.data["text/plain"];
};

describe("writePendingLinkToClipboard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts the write during the click and fills it once the link is made", async () => {
    const clipboard = stubClipboard(readItems);
    let resolve: (url: string) => void = () => undefined;
    const promise = new Promise<string>((settle) => {
      resolve = settle;
    });

    const copied = writePendingLinkToClipboard(promise);
    expect(clipboard.write).toHaveBeenCalledTimes(1);

    resolve(LINK);
    await copied;
    const [items] = clipboard.write.mock.calls[0]!;
    expect(await (await items[0]!.data["text/plain"]!).text()).toBe(LINK);
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it("writes the finished link as text where a pending write is refused", async () => {
    const clipboard = stubClipboard(async () => {
      throw new DOMException("Refused", "NotAllowedError");
    });

    await writePendingLinkToClipboard(Promise.resolve(LINK));
    expect(clipboard.writeText).toHaveBeenCalledWith(LINK);
  });

  it("rejects with the link's own failure and writes nothing", async () => {
    const clipboard = stubClipboard(readItems);
    const failure = new Error("Preview links are not set up on Dorothy.");

    await expect(writePendingLinkToClipboard(Promise.reject(failure))).rejects.toBe(failure);
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });
});
