export const WORKFLOW_IDS = {
  review: "loom-engineering-review",
  intake: "loom-intake-reproduce",
  compatibility: "loom-upstream-compatibility",
  performance: "loom-performance-review",
} as const;
export const WORKFLOW_TRIGGER_HINTS: Readonly<
  Record<
    string,
    { readonly kind: "schedule" | "webhook"; readonly weekday: number; readonly timeOfDay: string }
  >
> = {
  [WORKFLOW_IDS.review]: { kind: "schedule", weekday: 1, timeOfDay: "09:00" },
  [WORKFLOW_IDS.intake]: { kind: "webhook", weekday: 1, timeOfDay: "09:00" },
  [WORKFLOW_IDS.compatibility]: { kind: "schedule", weekday: 1, timeOfDay: "09:30" },
  [WORKFLOW_IDS.performance]: { kind: "schedule", weekday: 5, timeOfDay: "10:00" },
};
