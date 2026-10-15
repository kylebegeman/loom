import type {
  SwitchboardLimit,
  SwitchboardLimits,
  SwitchboardModelAvailability,
} from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";

/**
 * Switchboard's controller evaluates its cached readings on every request, so
 * `evaluatedAt` is the time of this read. An older one means something cached
 * the response, or the clocks disagree, and none of it is trusted to block models.
 */
export const AVAILABILITY_MAX_AGE_MS = 5 * 60_000;
const FUTURE_SKEW_MS = 60_000;

/** Whether a controller response was evaluated recently by this server's clock. */
export function isCurrentEvaluation(evaluatedAt: string, now: number): boolean {
  const at = Date.parse(evaluatedAt);
  return Number.isFinite(at) && at <= now + FUTURE_SKEW_MS && now - at <= AVAILABILITY_MAX_AGE_MS;
}

/**
 * `GET /api/v1/availability` from the controller's cached operations API. States
 * and providers are read as strings: Switchboard asks clients to treat values they
 * do not know conservatively, and here that means as unknown, never as blocked.
 */
export const SwitchboardAvailability = Schema.Struct({
  version: Schema.Literal(1),
  service: Schema.Literal("switchboard"),
  evaluatedAt: Schema.String,
  models: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      provider: Schema.String,
      state: Schema.String,
      reason: Schema.String,
      resetAt: Schema.optional(Schema.NullOr(Schema.Number)),
    }),
  ),
});
type SwitchboardAvailability = typeof SwitchboardAvailability.Type;

const DRIVERS = { claude: "claudeAgent", codex: "codex" } as const;
const STATES: ReadonlySet<string> = new Set(["available", "restricted", "unavailable", "unknown"]);

const STALE: SwitchboardLimits = { limits: [], availability: "stale" };

/**
 * Turns Switchboard's per-model states into what the picker blocks. Only a
 * confirmed `unavailable` blocks its model. A provider gets a provider-wide limit
 * only when every model Switchboard lists for it is confirmed unavailable or
 * credit-only, so models missing from its catalog stay selectable otherwise.
 */
export function switchboardLimits(
  snapshot: SwitchboardAvailability,
  now: number,
): SwitchboardLimits {
  if (!isCurrentEvaluation(snapshot.evaluatedAt, now)) return STALE;
  const models: SwitchboardModelAvailability[] = snapshot.models.flatMap((model) => {
    const driver = DRIVERS[model.provider as keyof typeof DRIVERS];
    if (driver === undefined) return [];
    const resetAt = model.resetAt ?? null;
    return [
      {
        driver,
        id: model.id,
        state: STATES.has(model.state)
          ? (model.state as SwitchboardModelAvailability["state"])
          : "unknown",
        reason: model.reason,
        resetAt: resetAt !== null && Number.isFinite(resetAt) && resetAt > now ? resetAt : null,
      },
    ];
  });
  const limits: SwitchboardLimit[] = [];
  for (const driver of Object.values(DRIVERS)) {
    const listed = models.filter((model) => model.driver === driver);
    if (
      listed.length === 0 ||
      listed.some((model) => model.state === "available" || model.state === "unknown")
    ) {
      continue;
    }
    const resets = listed.flatMap((model) => (model.resetAt === null ? [] : [model.resetAt]));
    limits.push({
      driver,
      servedModels: listed.filter((model) => model.state === "restricted").map((model) => model.id),
      until: resets.length > 0 ? Math.min(...resets) : null,
    });
  }
  return { limits, models, availability: "available" };
}
