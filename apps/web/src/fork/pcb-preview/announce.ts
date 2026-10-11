import type { PcbCheckKind, PcbCheckResult, PcbComponent } from "@t3tools/contracts/fork";
export type PcbAnnounceInput = {
  place: string;
  selection: string | null;
  tool: string | null;
  checking: PcbCheckKind | null;
  checks: Partial<Record<PcbCheckKind, Pick<PcbCheckResult, "ranAt" | "outcome" | "counts">>>;
  building: boolean;
  shown: { surface: string; sheet: string; sourceHash: string } | null;
  three: "loading" | "ready" | null;
  notice: string | null;
  step: { id: number; text: string } | null;
};
export function describeSelection(
  components: readonly PcbComponent[],
  selected: string | null,
  pin: string | null,
  net: string | null,
): string | null {
  if (selected) {
    const component = components.find((component) => component.reference === selected);
    if (pin) {
      const detail = component?.pins.find((detail) => detail.number === pin);
      return [
        `${selected} pin ${pin}`,
        detail?.name,
        net ? `net ${net}` : detail?.net ? `net ${detail.net}` : null,
      ]
        .filter(Boolean)
        .join(", ");
    }
    return [selected, component?.value].filter(Boolean).join(", ");
  }
  return net ? `Net ${net}` : null;
}
/** Speak the action's result once, ahead of incidental selection and loading changes. */
export function announcement(
  previous: PcbAnnounceInput | null,
  next: PcbAnnounceInput,
): string | null {
  if (!previous) return null;
  if (next.step && next.step.id !== previous.step?.id) return next.step.text;
  if (next.selection !== previous.selection) return next.selection ?? "Selection cleared";
  if (next.place !== previous.place) return next.place;
  if (next.tool !== previous.tool) return next.tool ?? "Select";
  if (next.checking && next.checking !== previous.checking)
    return `Running ${next.checking.toUpperCase()}`;
  if (previous.checking && !next.checking) {
    const kind = previous.checking,
      result = next.checks[kind];
    if (result && result.ranAt !== previous.checks[kind]?.ranAt) {
      const label = kind.toUpperCase();
      if (result.outcome === "failed" || result.outcome === "timed-out")
        return `${label} could not run`;
      if (result.outcome === "clean") return `${label} clean`;
      const counts = [
        result.counts.errors
          ? `${result.counts.errors} ${result.counts.errors === 1 ? "error" : "errors"}`
          : null,
        result.counts.warnings
          ? `${result.counts.warnings} ${result.counts.warnings === 1 ? "warning" : "warnings"}`
          : null,
      ].filter(Boolean);
      return counts.length ? `${label}: ${counts.join(", ")}` : `${label} clean`;
    }
  }
  if (next.three !== previous.three) {
    if (next.three === "loading") return "Loading 3D board";
    if (next.three === "ready") return "3D board ready";
  }
  const surface =
    next.shown?.surface === "pcb" || next.place.startsWith("Board") ? "Board" : "Schematic";
  if (next.building && !previous.building && !next.shown)
    return `Building ${surface.toLowerCase()}`;
  if (
    next.shown &&
    previous.shown &&
    next.shown.surface === previous.shown.surface &&
    next.shown.sheet === previous.shown.sheet &&
    next.shown.sourceHash !== previous.shown.sourceHash
  )
    return `${surface} updated`;
  if (next.shown && !previous.shown && previous.building) return `${surface} ready`;
  if (next.notice && next.notice !== previous.notice) return next.notice;
  return null;
}
