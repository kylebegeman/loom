import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";

import { makeCliproxyApi } from "../../usage/cliproxyApi.ts";
import { setSwitchboardEnabled, setSwitchboardEnvironment } from "./switchboard.ts";
import { CachedUsage, cachedUsageAccounts } from "./usage.ts";

const EVALUATED_AT = "2026-10-02T20:00:00.000Z";
const NOW = Date.parse(EVALUATED_AT);
const HOUR = 3_600_000;
const CONTROLLER = "http://127.0.0.1:8318";
const hub = {
  kind: "cliproxy",
  url: "http://127.0.0.1:8317",
  managementKey: "management-fixture",
  enabled: true,
} as const;

const files = [
  {
    id: "codex-a",
    name: "codex-a.json",
    auth_index: "a",
    provider: "codex",
    email: "a@example.test",
    id_token: { chatgpt_account_id: "workspace-a" },
  },
  {
    id: "claude-b",
    name: "claude-b.json",
    auth_index: "b",
    provider: "claude",
    email: "b@example.test",
  },
  {
    id: "codex-off",
    name: "codex-off.json",
    auth_index: "c",
    provider: "codex",
    disabled: true,
  },
];

type Snapshot = typeof CachedUsage.Type;
type Account = Snapshot["accounts"][number];
const codexAccount = (overrides: Partial<Account> = {}): Account => ({
  id: "codex-a.json",
  email: "a@example.test",
  provider: "codex",
  usage: {
    session: { usedPercent: 20, resetsAt: NOW + HOUR },
    weekly: { usedPercent: 60, resetsAt: NOW + 24 * HOUR },
    plan: "pro",
  },
  usageAt: EVALUATED_AT,
  stale: false,
  reused: false,
  error: null,
  resetCredits: {
    checkedAt: EVALUATED_AT,
    availableCount: 2,
    nextCreditId: "credit-1",
    nextExpiresAt: "2099-01-01T00:00:00.000Z",
  },
  ...overrides,
});
const claudeAccount: Account = {
  id: "claude-b.json",
  email: "b@example.test",
  provider: "claude",
  usage: {
    session: { usedPercent: 10, resetsAt: null },
    weekly: { usedPercent: 50, resetsAt: NOW + 24 * HOUR },
    scoped: [{ model: "Fable", usedPercent: 80, resetsAt: null }],
  },
  usageAt: EVALUATED_AT,
  stale: false,
  reused: false,
};
const usage = (
  accounts: ReadonlyArray<Account>,
  overrides: Partial<Omit<Snapshot, "accounts">> = {},
): Snapshot => ({
  version: 1,
  service: "switchboard",
  evaluatedAt: EVALUATED_AT,
  health: { stale: false, error: null },
  accounts,
  ...overrides,
});

interface Recorded {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
}

const fixture = (
  options: {
    readonly usage?: Response;
    readonly authFiles?: Response;
    readonly refreshStatus?: number;
  } = {},
) => {
  const requests: Array<Recorded> = [];
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      requests.push({ method: request.method, url: request.url, headers: { ...request.headers } });
      const { pathname } = new URL(request.url);
      const respond = (response: Response) => HttpClientResponse.fromWeb(request, response);
      switch (pathname) {
        case "/api/v1/usage":
          return respond(
            options.usage ??
              Response.json(
                usage([
                  codexAccount(),
                  claudeAccount,
                  codexAccount({ id: "codex-off.json" }),
                  codexAccount({ id: "gemini-c.json", provider: "gemini" }),
                ]),
              ),
          );
        case "/api/dashboard":
          return respond(Response.json({ csrfToken: "csrf-fixture" }));
        case "/api/v1/refresh":
          return respond(new Response(null, { status: options.refreshStatus ?? 202 }));
        case "/v0/management/auth-files":
          return respond(options.authFiles ?? Response.json({ files }));
        case "/v0/management/reset-quota":
          return respond(Response.json({}));
        case "/v0/management/api-call": {
          const body =
            request.body._tag === "Uint8Array"
              ? (JSON.parse(new TextDecoder().decode(request.body.body)) as { url?: string })
              : {};
          const upstream = body.url?.endsWith("/consume")
            ? { code: "reset" }
            : body.url?.endsWith("/rate-limit-reset-credits")
              ? { credits: [] }
              : { rate_limit: { primary_window: { used_percent: 12 } } };
          return respond(Response.json({ status_code: 200, body: JSON.stringify(upstream) }));
        }
        default:
          return respond(new Response(null, { status: 404 }));
      }
    }),
  );
  const api = makeCliproxyApi.pipe(
    Effect.provideService(HttpClient.HttpClient, http),
    Effect.provide(NodeCrypto.layer),
  );
  return { api, requests };
};

const polledProviders = (requests: ReadonlyArray<Recorded>) =>
  requests.filter((request) => request.url.endsWith("/v0/management/api-call"));
const controllerReads = (requests: ReadonlyArray<Recorded>) =>
  requests.filter((request) => request.url.startsWith(CONTROLLER));

beforeEach(() => {
  setSwitchboardEnvironment({}, "darwin");
  setSwitchboardEnabled(true);
});
afterEach(() => {
  setSwitchboardEnabled(false);
  setSwitchboardEnvironment({}, "darwin");
});

describe("Switchboard cached usage through the hub source", () => {
  it.effect("reads the controller's readings for the routed hub instead of polling", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const test = fixture();
      const api = yield* test.api;
      const accounts = yield* api.readAccounts(hub);

      expect(accounts.map((account) => [account.id, account.driver])).toEqual([
        ["codex-a", "codex"],
        ["claude-b", "claudeAgent"],
      ]);
      const [codex, claude] = accounts;
      expect(codex?.workspaceId).toBe("workspace-a");
      expect(codex?.email).toBe("a@example.test");
      expect(codex?.usageLimits.windows.map((window) => window.usedPercent)).toEqual([20, 60]);
      expect(codex?.usageLimits.resetCredits).toEqual({
        availableCount: 2,
        nextCreditId: "credit-1",
        nextExpiresAt: "2099-01-01T00:00:00.000Z",
      });
      expect(claude?.usageLimits.windows.map((window) => window.usedPercent)).toEqual(
        expect.arrayContaining([10, 50, 80]),
      );
      expect(polledProviders(test.requests)).toEqual([]);
      const [read] = controllerReads(test.requests);
      expect(read?.url).toBe(`${CONTROLLER}/api/v1/usage`);
      // The hub's management key belongs to the hub alone.
      expect(read?.headers.authorization).toBeUndefined();
    }),
  );

  it.effect("keeps the controller's readings when the hub cannot list accounts", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const test = fixture({ authFiles: new Response(null, { status: 500 }) });
      const accounts = yield* (yield* test.api).readAccounts(hub);
      expect(accounts.map((account) => account.id)).toEqual([
        "codex-a.json",
        "claude-b.json",
        "codex-off.json",
      ]);
      expect(accounts[0]?.workspaceId).toBeUndefined();
      expect(polledProviders(test.requests)).toEqual([]);
    }),
  );

  it.effect.each([
    ["an error status", new Response(null, { status: 503 })],
    ["another API version", Response.json({ ...usage([]), version: 2 })],
  ] as const)("never polls providers in place of a controller returning %s", ([, response]) =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const test = fixture({ usage: response });
      const error = yield* (yield* test.api).readAccounts(hub).pipe(Effect.flip);
      expect(error.detail).toContain("did not poll providers");
      expect(polledProviders(test.requests)).toEqual([]);
    }),
  );

  it.effect.each([
    ["routing is off", false, hub.url],
    ["the hub is not the routed one", true, "http://hub.example.test:8317"],
  ] as const)("polls a plain hub itself when %s", ([, routed, url]) =>
    Effect.gen(function* () {
      setSwitchboardEnabled(routed);
      yield* TestClock.setTime(NOW);
      const test = fixture({ authFiles: Response.json({ files: [files[0]] }) });
      const accounts = yield* (yield* test.api).readAccounts({ ...hub, url });
      expect(accounts[0]?.usageLimits.windows[0]?.usedPercent).toBe(12);
      expect(polledProviders(test.requests).length).toBeGreaterThan(0);
      expect(controllerReads(test.requests)).toEqual([]);
    }),
  );

  it.effect("asks the controller to collect again after a redemption", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const test = fixture();
      const result = yield* (yield* test.api).consume(hub, "codex-a.json", "credit-1");
      expect(result).toEqual({ outcome: "reset" });
      const [dashboard, refresh] = controllerReads(test.requests);
      expect(dashboard).toMatchObject({ method: "GET", url: `${CONTROLLER}/api/dashboard` });
      expect(refresh).toMatchObject({ method: "POST", url: `${CONTROLLER}/api/v1/refresh` });
      expect(refresh?.headers.origin).toBe(CONTROLLER);
      expect(refresh?.headers["x-switchboard-csrf"]).toBe("csrf-fixture");
      expect(refresh?.headers.authorization).toBeUndefined();
    }),
  );

  it.effect.each([429, 500])("keeps a redemption when the collection request gets %s", (status) =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const test = fixture({ refreshStatus: status });
      const result = yield* (yield* test.api).consume(hub, "codex-a.json", "credit-1");
      expect(result).toEqual({ outcome: "reset" });
    }),
  );
});

describe("cachedUsageAccounts", () => {
  const unavailable = (snapshot: Snapshot, now = NOW) =>
    cachedUsageAccounts(snapshot, now, files).map((account) => ({
      reason: account.usageLimits.unavailable?.reason,
      resetCredits: account.usageLimits.resetCredits,
    }));

  it.each([
    ["stale", usage([codexAccount({ stale: true })])],
    ["reused", usage([codexAccount({ reused: true })])],
    ["failed", usage([codexAccount({ error: "fetch-failed" })])],
    ["never observed", usage([codexAccount({ usageAt: null })])],
    ["from a stale collector", usage([codexAccount()], { health: { stale: true } })],
    [
      "from a failed controller pass",
      usage([codexAccount()], { health: { error: "controller-pass-failed" } }),
    ],
  ] as const)("reports a %s reading as unavailable, without credits", (_label, snapshot) => {
    expect(unavailable(snapshot)).toEqual([{ reason: "probeFailed", resetCredits: undefined }]);
  });

  it("reports an old evaluation as unavailable", () => {
    expect(unavailable(usage([codexAccount()]), NOW + 24 * HOUR)).toEqual([
      { reason: "probeFailed", resetCredits: undefined },
    ]);
  });

  it("keeps the original observation time of a current reading", () => {
    const observedAt = "2026-10-02T19:59:00.000Z";
    const [account] = cachedUsageAccounts(
      usage([codexAccount({ usageAt: observedAt })]),
      NOW,
      files,
    );
    expect(account?.usageLimits.checkedAt).toBe(observedAt);
    expect(account?.usageLimits.unavailable).toBeUndefined();
  });

  it.each([
    ["checked too long ago", { checkedAt: "2026-10-02T19:49:00.000Z" }],
    ["already expired", { nextExpiresAt: "2026-10-02T19:00:00.000Z" }],
    ["checked in the future", { checkedAt: "2026-10-02T20:05:00.000Z" }],
    ["reported with an error", { error: "credits-unavailable" }],
  ] as const)("leaves out reset credits %s but keeps the windows", (_label, credits) => {
    const [account] = cachedUsageAccounts(
      usage([
        codexAccount({
          resetCredits: {
            checkedAt: EVALUATED_AT,
            availableCount: 1,
            nextCreditId: "credit-1",
            nextExpiresAt: "2099-01-01T00:00:00.000Z",
            ...credits,
          },
        }),
      ]),
      NOW,
      files,
    );
    expect(account?.usageLimits.resetCredits).toBeUndefined();
    expect(account?.usageLimits.windows.length).toBeGreaterThan(0);
  });
});
