import { AtomRegistry } from "effect/reactivity";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { afterAll, afterEach, describe, expect, it, vi } from "vite-plus/test";

import { isRuntimeArchivePublished, runtimeReleaseAssetsAtom } from "./runtimeRelease";

const version = "0.0.46-nightly.20261012.3021";

// FetchHttpClient retains its fetch implementation across checks.
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

async function settledCheck() {
  const atom = runtimeReleaseAssetsAtom(version);
  const registry = AtomRegistry.make();
  const unmount = registry.mount(atom);
  try {
    await vi.waitFor(() => {
      const result = registry.get(atom);
      expect(AsyncResult.isInitial(result) || result.waiting).toBe(false);
    });
    return registry.get(atom);
  } finally {
    unmount();
    registry.dispose();
  }
}

describe("runtimeReleaseAssetsAtom", () => {
  it("requires the computer's archive and checksums, never a different platform's assets", () => {
    const assets = ["SHA256SUMS", `t3-${version}-linux-x64.tar.gz`];
    expect(isRuntimeArchivePublished(assets, version, { os: "linux", arch: "x64" })).toBe(true);
    expect(isRuntimeArchivePublished(assets, version, { os: "linux", arch: "arm64" })).toBe(false);
    expect(isRuntimeArchivePublished(assets.slice(1), version, { os: "linux", arch: "x64" })).toBe(
      false,
    );
    expect(isRuntimeArchivePublished(assets, version, { os: "unknown", arch: "other" })).toBe(
      false,
    );
  });
  afterEach(() => {
    fetchMock.mockReset();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("checks the Loom release without tracing headers", async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({
        draft: false,
        assets: [{ name: "SHA256SUMS" }, { name: `t3-${version}-linux-x64.tar.gz` }],
      }),
    );

    const result = await settledCheck();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = new Request(fetchMock.mock.calls[0]?.[0] ?? "", fetchMock.mock.calls[0]?.[1]);
    expect(request.url).toBe(
      `https://api.github.com/repos/kylebegeman/loom/releases/tags/${version}`,
    );
    expect(request.headers.get("traceparent")).toBeNull();
    expect(request.headers.get("b3")).toBeNull();
    expect(AsyncResult.getOrElse(result, () => [])).toEqual([
      "SHA256SUMS",
      `t3-${version}-linux-x64.tar.gz`,
    ]);
  });

  it("reports a missing release as unpublished", async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 404 }));

    const result = await settledCheck();

    expect(AsyncResult.isSuccess(result)).toBe(true);
    expect(AsyncResult.getOrElse(result, () => ["unexpected"])).toEqual([]);
  });

  it("does not offer archives attached to a draft release", async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({ draft: true, assets: [{ name: "SHA256SUMS" }] }),
    );
    expect(AsyncResult.getOrElse(await settledCheck(), () => ["unexpected"])).toEqual([]);
  });

  it("keeps a malformed release response unknown", async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({ draft: false, assets: ["not-an-asset"] }),
    );
    expect(AsyncResult.isFailure(await settledCheck())).toBe(true);
  });

  it("leaves a failed first check unknown, so callers cannot offer an unverified runtime", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await settledCheck();

    expect(AsyncResult.isFailure(result)).toBe(true);
    expect(AsyncResult.getOrElse(result, () => [])).toEqual([]);
  });
});
