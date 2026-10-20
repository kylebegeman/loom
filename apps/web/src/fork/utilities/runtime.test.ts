import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { cryptoRandom } from "./runtime";

describe("cryptoRandom", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fills more than one getRandomValues call allows", () => {
    const spy = vi.spyOn(globalThis.crypto, "getRandomValues");
    const bytes = cryptoRandom(65_536 * 2 + 10);
    expect(bytes).toHaveLength(65_546 + 65_536);
    expect(spy.mock.calls.map(([view]) => (view as Uint8Array).length)).toEqual([
      65_536, 65_536, 10,
    ]);
    // The tail was filled too, not left as zeros.
    expect(bytes.subarray(-10).some((byte) => byte !== 0)).toBe(true);
  });

  it("returns an empty array for zero bytes without calling the API", () => {
    const spy = vi.spyOn(globalThis.crypto, "getRandomValues");
    expect(cryptoRandom(0)).toHaveLength(0);
    expect(spy).not.toHaveBeenCalled();
  });
});
