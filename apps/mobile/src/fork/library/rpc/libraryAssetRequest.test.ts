import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  libraryAssetUrl,
  libraryRecoveryUrl,
  requestLibraryAsset,
  type LibraryAssetFetch,
} from "./libraryAssetRequest";
const signal = new AbortController().signal;
describe("central mobile attachment transport", () => {
  it("qualifies recovery archives by their original computer, copy, and immutable checksum", () => {
    const digest = "a".repeat(64);
    expect(
      libraryRecoveryUrl(
        "https://library.example",
        EnvironmentId.make("source:host"),
        "copy:one",
        digest,
      ),
    ).toBe(`https://library.example/api/loom/library/recovery/source:host/copy:one/${digest}`);
    for (const [source, copy, checksum] of [
      ["..", "copy", digest],
      ["source", "../copy", digest],
      ["source", "copy", "bad"],
    ])
      expect(() =>
        libraryRecoveryUrl(
          "https://library.example",
          EnvironmentId.make(source!),
          copy!,
          checksum!,
        ),
      ).toThrow("invalid identifier or checksum");
  });
  it("reports a missing recovery archive without claiming it is an attachment upload", async () => {
    const request = vi
      .fn<LibraryAssetFetch>()
      .mockResolvedValue(new Response(null, { status: 404 }));
    await expect(
      requestLibraryAsset(
        {
          url: "https://library.example/api/loom/library/recovery/source/copy/sha",
          headers: { Authorization: "Bearer session" },
          signal,
          kind: "recovery",
        },
        request,
      ),
    ).rejects.toThrow("recovery archive is unavailable");
  });
  it("uses source-qualified identifiers under the selected library origin", () => {
    expect(
      libraryAssetUrl("https://library.example", EnvironmentId.make("source:host"), "file:one"),
    ).toBe("https://library.example/api/loom/library/assets/source:host/file:one");
    expect(() =>
      libraryAssetUrl("https://library.example", EnvironmentId.make("source"), "../file"),
    ).toThrow("invalid identifier");
    expect(() =>
      libraryAssetUrl("https://library.example", EnvironmentId.make(".."), "file"),
    ).toThrow("invalid identifier");
  });
  it("authorizes inline library bytes and strips credentials before a signed storage redirect", async () => {
    const request = vi
      .fn<LibraryAssetFetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://storage.example/signed-attachment" },
        }),
      )
      .mockResolvedValueOnce(new Response("saved bytes"));
    const response = await requestLibraryAsset(
      {
        url: "https://library.example/api/loom/library/assets/source/file",
        headers: { Authorization: "Bearer test-session", DPoP: "test-proof" },
        signal,
      },
      request,
    );
    expect(response.ok).toBe(true);
    expect(request).toHaveBeenNthCalledWith(
      1,
      "https://library.example/api/loom/library/assets/source/file",
      expect.objectContaining({
        headers: { Authorization: "Bearer test-session", DPoP: "test-proof" },
        redirect: "manual",
        credentials: "omit",
      }),
    );
    expect(request).toHaveBeenNthCalledWith(2, "https://storage.example/signed-attachment", {
      signal,
      redirect: "error",
      credentials: "omit",
    });
  });
  it("reports expired library access and missing uploads without trying another host", async () => {
    const request = vi
      .fn<LibraryAssetFetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const input = {
      url: "https://library.example/api/loom/library/assets/source/file",
      headers: { Authorization: "Bearer test-session" },
      signal,
    };
    await expect(requestLibraryAsset(input, request)).rejects.toThrow(
      "Sign in to this library again",
    );
    await expect(requestLibraryAsset(input, request)).rejects.toThrow(
      "has not reached the library",
    );
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("refuses an invalid signed destination before forwarding any request", async () => {
    const request = vi.fn<LibraryAssetFetch>().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://storage.example/attachment" },
      }),
    );
    await expect(
      requestLibraryAsset(
        {
          url: "https://library.example/api/loom/library/assets/source/file",
          headers: { Authorization: "Bearer test-session" },
          signal,
        },
        request,
      ),
    ).rejects.toThrow("invalid stored attachment address");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
