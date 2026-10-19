import { describe, expect, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import type { PreviewLink } from "@t3tools/contracts/fork";
import {
  isoAt,
  isPreviewPortDenied,
  nextPreviewDeadline,
  previewMachineSlug,
  randomShareSegment,
  sanitizeEntryPath,
  signPreviewCookie,
  sweepPreviewLinks,
  verifyPreviewCookie,
} from "./policy.ts";

const key = new Uint8Array(32).fill(7);
const host = "5173-abc123-dorothy.bagels.top";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const link = (overrides: Partial<PreviewLink>): PreviewLink => ({
  id: "link",
  kind: "port",
  port: 5173,
  host,
  url: `https://${host}/`,
  createdBy: "owner",
  threadId: null,
  laneId: null,
  state: "open",
  lifetime: "1h",
  createdAt: isoAt(0),
  expiresAt: isoAt(HOUR),
  endedAt: null,
  restorableUntil: null,
  ...overrides,
});

describe("isPreviewPortDenied", () => {
  it("denies system ports, known services and the server's own listeners", () => {
    expect(isPreviewPortDenied(80, [])).toBe(true);
    expect(isPreviewPortDenied(5432, [])).toBe(true);
    expect(isPreviewPortDenied(3773, [])).toBe(true);
    expect(isPreviewPortDenied(4100, [4100])).toBe(true);
    expect(isPreviewPortDenied(5173, [null, undefined, 4100])).toBe(false);
  });
});

describe("previewMachineSlug", () => {
  it("keeps the first label's letters and digits", () => {
    expect(previewMachineSlug("Dorothy.local")).toBe("dorothy");
    expect(previewMachineSlug("kyle's-mac-mini")).toBe("kylesmacmini");
    expect(previewMachineSlug("---")).toBe("loom");
  });
});

describe("randomShareSegment", () => {
  it("is six lowercase letters or digits", () => {
    for (let index = 0; index < 50; index += 1) {
      expect(randomShareSegment()).toMatch(/^[a-z0-9]{6}$/);
    }
  });
});

describe("sanitizeEntryPath", () => {
  it("keeps same-host paths with their query and fragment", () => {
    expect(sanitizeEntryPath("/app/settings?tab=1#top")).toBe("/app/settings?tab=1#top");
    expect(sanitizeEntryPath("/café")).toBe("/caf%C3%A9");
  });

  it("falls back to the root for anything that could leave the host or break a header", () => {
    for (const path of [
      undefined,
      "",
      "app",
      "//evil.example",
      "/\\evil.example",
      "/a\r\nSet-Cookie: x=1",
      "/__loom/enter?code=abc",
      "https://evil.example/",
    ]) {
      expect(sanitizeEntryPath(path)).toBe("/");
    }
  });
});

describe("preview cookies", () => {
  const claims = { sub: "owner", sid: "session-1", host, exp: 1_000 };
  const value = signPreviewCookie(claims, key);

  it("verifies its own signature for the same host before expiry", () => {
    expect(verifyPreviewCookie(value, key, host, 999_000)).toEqual({
      sid: "session-1",
      sub: "owner",
    });
  });

  it("rejects tampering, another host, another key and expiry", () => {
    const [payload, signature] = value.split(".");
    const forged = Buffer.from(JSON.stringify({ ...claims, v: 1, sub: "someone-else" })).toString(
      "base64url",
    );
    expect(verifyPreviewCookie(`${forged}.${signature}`, key, host, 0)).toBeNull();
    expect(verifyPreviewCookie(`${payload}.${signature}x`, key, host, 0)).toBeNull();
    expect(verifyPreviewCookie(value, key, "3000-abc123-dorothy.bagels.top", 0)).toBeNull();
    expect(verifyPreviewCookie(value, new Uint8Array(32).fill(8), host, 0)).toBeNull();
    expect(verifyPreviewCookie(value, key, host, 1_000_000)).toBeNull();
    expect(verifyPreviewCookie("garbage", key, host, 0)).toBeNull();
  });
});

describe("sweepPreviewLinks", () => {
  it("expires open links at their deadline and purges them after the restore window", () => {
    const open = link({});
    expect(sweepPreviewLinks([open], HOUR - 1).changed).toBe(false);

    const expired = sweepPreviewLinks([open], HOUR + 5_000);
    expect(expired.links).toEqual([
      {
        ...open,
        state: "expired",
        endedAt: isoAt(HOUR),
        restorableUntil: isoAt(HOUR + 7 * DAY),
      },
    ]);
    expect(nextPreviewDeadline(expired.links)).toBe(HOUR + 7 * DAY);

    expect(sweepPreviewLinks(expired.links, HOUR + 7 * DAY).links).toEqual([]);
  });

  it("drops a link that expired so long ago it is already past its restore window", () => {
    expect(sweepPreviewLinks([link({})], HOUR + 8 * DAY).links).toEqual([]);
  });

  it("tracks the soonest deadline across open and ended links", () => {
    const agentLink = link({
      id: "agent",
      createdBy: "agent",
      threadId: ThreadId.make("thread-a"),
      expiresAt: isoAt(3 * HOUR),
    });
    const ended = link({
      id: "ended",
      state: "revoked",
      endedAt: isoAt(0),
      restorableUntil: isoAt(2 * HOUR),
    });
    expect(nextPreviewDeadline([agentLink, ended])).toBe(2 * HOUR);
    expect(nextPreviewDeadline([])).toBeNull();
  });
});
