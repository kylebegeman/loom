import type { PreviewLink, PreviewLinksSettings } from "@t3tools/contracts/fork";
import { describe, expect, it } from "vite-plus/test";
import { linkTiming, settingsFromDraft, visibleLinks, type SettingsDraft } from "./links";

const NOW = Date.parse("2026-10-18T12:00:00.000Z");
const HOUR = 3_600_000;
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

const SETTINGS: PreviewLinksSettings = {
  enabled: true,
  suffix: "bagels.top",
  machine: "dorothy",
  defaultLifetime: "12h",
  gatewayPort: 3779,
};

const link = (id: string, patch: Partial<PreviewLink> = {}): PreviewLink => ({
  id,
  kind: "port",
  port: 5173,
  host: "5173-k3f9x2-dorothy.bagels.top",
  url: "https://5173-k3f9x2-dorothy.bagels.top/",
  createdBy: "owner",
  threadId: null,
  laneId: null,
  state: "open",
  lifetime: "12h",
  createdAt: at(-HOUR),
  expiresAt: at(11 * HOUR),
  endedAt: null,
  restorableUntil: null,
  ...patch,
});

describe("visibleLinks", () => {
  it("lists open links newest first, then ended links that can still be restored", () => {
    const older = link("older", { createdAt: at(-3 * HOUR) });
    const newer = link("newer", { createdAt: at(-HOUR) });
    const ended = link("ended", {
      state: "revoked",
      endedAt: at(-2 * HOUR),
      restorableUntil: at(24 * HOUR),
    });
    const recentlyExpired = link("expired", {
      state: "expired",
      expiresAt: at(-HOUR),
      restorableUntil: at(24 * HOUR),
    });
    const tooOld = link("too-old", {
      state: "revoked",
      endedAt: at(-8 * 24 * HOUR),
      restorableUntil: at(-HOUR),
    });
    expect(
      visibleLinks([ended, older, tooOld, recentlyExpired, newer], SETTINGS, NOW).map(
        (each) => each.id,
      ),
    ).toEqual(["newer", "older", "expired", "ended"]);
  });

  it("hides ended links from another computer name or domain until settings change back", () => {
    const ended = link("ended", {
      state: "revoked",
      endedAt: at(-HOUR),
      restorableUntil: at(24 * HOUR),
    });
    const ids = (settings: PreviewLinksSettings) =>
      visibleLinks([ended], settings, NOW).map((each) => each.id);
    expect(ids({ ...SETTINGS, machine: "laptop" })).toEqual([]);
    expect(ids({ ...SETTINGS, suffix: "example.com" })).toEqual([]);
    expect(ids({ ...SETTINGS, suffix: null })).toEqual([]);
    expect(ids(SETTINGS)).toEqual(["ended"]);
  });
});

describe("linkTiming", () => {
  it("counts down an open link and counts up from when one ended", () => {
    expect(linkTiming(link("a", { expiresAt: at(3 * HOUR + 12 * 60_000) }), NOW)).toBe(
      "Ends in 3h 12m",
    );
    expect(linkTiming(link("b", { expiresAt: at(-1) }), NOW)).toBe("Ending now");
    expect(linkTiming(link("c", { state: "expired", expiresAt: at(-2 * HOUR) }), NOW)).toBe(
      "Expired 2h ago",
    );
    expect(linkTiming(link("d", { state: "revoked", endedAt: at(-10_000) }), NOW)).toBe(
      "Ended just now",
    );
  });
});

describe("settingsFromDraft", () => {
  const draft: SettingsDraft = {
    enabled: true,
    suffix: " Bagels.Top ",
    machine: "Dorothy",
    defaultLifetime: "12h",
    gatewayPort: "3779",
  };

  it("normalizes the domain and computer name the way the server stores them", () => {
    expect(settingsFromDraft(draft)).toEqual({
      settings: {
        enabled: true,
        suffix: "bagels.top",
        machine: "dorothy",
        defaultLifetime: "12h",
        gatewayPort: 3779,
      },
    });
  });

  it("allows turning links on before a domain is chosen", () => {
    expect(settingsFromDraft({ ...draft, suffix: "" })).toMatchObject({
      settings: { enabled: true, suffix: null },
    });
  });

  it("names the first field the server would reject", () => {
    expect(settingsFromDraft({ ...draft, suffix: "localhost" })).toEqual({
      problem: "Use a domain you own, such as example.com.",
    });
    expect(settingsFromDraft({ ...draft, machine: "dorothy-mac" })).toEqual({
      problem: "Use up to 40 lowercase letters and digits for the computer name.",
    });
    expect(settingsFromDraft({ ...draft, gatewayPort: "80" })).toEqual({
      problem: "Use a gateway port from 1024 to 65535.",
    });
  });
});
