import type { SwitchboardLimit, SwitchboardLimits } from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/http";

/**
 * Which pooled providers Switchboard cannot serve on plan allowance, read from the
 * controller's status. When every Codex account is on credits the hub serves only
 * the credit models, so the picker can say so before a turn fails at the proxy.
 */
export const SWITCHBOARD_STATUS_URL = "http://127.0.0.1:8318/status";

/** The controller checks every few minutes; older status is not trusted to block models. */
export const STATUS_MAX_AGE_MS = 15 * 60_000;

const Window = Schema.NullOr(
  Schema.Struct({ usedPercent: Schema.Number, resetsAt: Schema.NullOr(Schema.Number) }),
);

const ControllerStatus = Schema.Struct({
  updatedAt: Schema.String,
  codexCreditModels: Schema.Array(Schema.String),
  accounts: Schema.Array(
    Schema.Struct({
      provider: Schema.String,
      state: Schema.String,
      usage: Schema.NullOr(Schema.Struct({ session: Window, weekly: Window })),
    }),
  ),
});
type ControllerStatus = typeof ControllerStatus.Type;
type StatusAccount = ControllerStatus["accounts"][number];

const DRIVERS = { claude: "claudeAgent", codex: "codex" } as const;

/** States in which an account still draws on plan allowance. */
const HAS_ALLOWANCE: ReadonlySet<string> = new Set(["ready", "unknown"]);

/** When an account gets allowance back: its 5-hour reset if only that is spent, else its weekly one. */
const regainsAt = (account: StatusAccount): number | null => {
  if (account.state === "signed-out") return null;
  const window =
    account.state === "session-limited" ? account.usage?.session : account.usage?.weekly;
  return window?.resetsAt ?? null;
};

const NO_LIMITS: SwitchboardLimits = { limits: [] };

export function switchboardLimits(status: ControllerStatus, now: number): SwitchboardLimits {
  const updatedAt = Date.parse(status.updatedAt);
  if (!Number.isFinite(updatedAt) || now - updatedAt > STATUS_MAX_AGE_MS) return NO_LIMITS;
  const limits: SwitchboardLimit[] = [];
  for (const [provider, driver] of Object.entries(DRIVERS)) {
    const accounts = status.accounts.filter((account) => account.provider === provider);
    if (accounts.length === 0 || accounts.some((account) => HAS_ALLOWANCE.has(account.state))) {
      continue;
    }
    const onCredits = accounts.some((account) => account.state === "credits");
    const resets = accounts.flatMap((account) => {
      const at = regainsAt(account);
      return at !== null && at > now ? [at] : [];
    });
    limits.push({
      driver,
      servedModels: onCredits ? status.codexCreditModels : [],
      until: resets.length > 0 ? Math.min(...resets) : null,
    });
  }
  return { limits };
}

/**
 * Reads the controller's status. Switchboard not running, or a status Loom cannot
 * read, blocks nothing: the hub reports its own errors.
 */
export const readSwitchboardLimits = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient;
  const response = yield* http.get(SWITCHBOARD_STATUS_URL);
  if (response.status !== 200) return NO_LIMITS;
  const status = yield* response.json.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(ControllerStatus)),
  );
  return switchboardLimits(status, yield* Clock.currentTimeMillis);
}).pipe(
  Effect.timeout("2 seconds"),
  Effect.orElseSucceed(() => NO_LIMITS),
);
