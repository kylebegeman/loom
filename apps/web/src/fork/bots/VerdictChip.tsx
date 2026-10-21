import type { BotVerdictValue } from "@t3tools/contracts/fork";
import { Badge } from "~/components/ui/badge";

export const VERDICT_LABELS: Record<BotVerdictValue, string> = {
  pass: "Pass",
  fail: "Fail",
  needs_attention: "Needs attention",
};

const VARIANTS = {
  pass: "success",
  fail: "error",
  needs_attention: "warning",
} as const satisfies Record<BotVerdictValue, "success" | "error" | "warning">;

export function VerdictChip({ verdict }: { readonly verdict: BotVerdictValue }) {
  return <Badge variant={VARIANTS[verdict]}>{VERDICT_LABELS[verdict]}</Badge>;
}
