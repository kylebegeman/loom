import * as DateTime from "effect/DateTime";
import type { OrchestrationV2ProviderTurn } from "@t3tools/contracts";
export const applyUsage = (last: number, next: number) => (next >= last ? next - last : next);
export const crossedLevels = (before: number, after: number, budget: number | null): number[] =>
  budget === null
    ? []
    : [80, 100].filter(
        (level) => before < (budget * level) / 100 && after >= (budget * level) / 100,
      );
export function serverLocalDay(
  iso: string,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(DateTime.toDateUtc(DateTime.makeUnsafe(iso)));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
/** v2 reports processed tokens per native turn. Context-window usedTokens is not spending. */
export function processedTokens(turn: OrchestrationV2ProviderTurn): number | null {
  const usage = turn.turnTokenUsage;
  if (
    !usage ||
    usage.usageStatus === "unavailable" ||
    usage.inputTokens === undefined ||
    usage.outputTokens === undefined
  )
    return null;
  return usage.inputTokens + usage.outputTokens;
}
