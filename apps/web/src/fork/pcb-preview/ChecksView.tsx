import { useState, useEffect, useRef } from "react";
import {
  CheckCircle2Icon,
  CopyIcon,
  LocateFixedIcon,
  MessageSquarePlusIcon,
  OctagonAlertIcon,
  PlayIcon,
  RotateCwIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type {
  PcbCheckActivity,
  PcbCheckKind,
  PcbCheckResult,
  PcbDesign,
  PcbViolation,
  PcbFinding,
} from "@t3tools/contracts/fork";
import { AutoCheckSettings } from "./AutoCheckSettings";
import { Switch } from "~/components/ui/switch";
import { orderFindings, checkFindings } from "./findings";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { appendSummary, checkSummary } from "./summary";
import { OperationStatus } from "./OperationStatus";
import { formatLength } from "./length";
import { useLengthUnit } from "./preferences";
import {
  Bar,
  EmptyState,
  Footer,
  Group,
  Log,
  Notice,
  Scroll,
  SearchField,
  Stat,
  Stats,
  type Tone,
} from "./InspectorKit";
import k from "./inspector.module.css";

/** Identical report entries get stable occurrence keys without dropping findings. */
function keyedRecords<A>(values: readonly A[]) {
  const occurrences = new Map<string, number>();
  return values.map((value) => {
    const identity = JSON.stringify(value);
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    return { value, key: `${identity}:${occurrence}` };
  });
}
const KINDS = {
  erc: { name: "ERC", surface: "Schematic", rules: "Electrical rules" },
  drc: { name: "DRC", surface: "Board", rules: "Clearances and connections" },
} as const;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const ruleName = (type: string) => {
  const words = type.replaceAll("_", " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : "Unnamed rule";
};
function status(
  result: PcbCheckResult | undefined,
  running: boolean,
  stale: boolean,
): { tone: Tone; text: string } {
  if (running) return { tone: "info", text: "Running" };
  if (!result) return { tone: "neutral", text: "Not run" };
  if (result.outcome === "failed") return { tone: "error", text: "Failed to run" };
  if (result.outcome === "timed-out") return { tone: "error", text: "Timed out" };
  const { errors, warnings } = result.counts;
  const text =
    result.outcome === "clean" || errors + warnings === 0
      ? "Clean"
      : [errors && plural(errors, "error"), warnings && plural(warnings, "warning")]
          .filter(Boolean)
          .join(" · ");
  return {
    tone: stale ? "neutral" : errors ? "error" : warnings ? "warning" : "success",
    text: stale ? `${text}, out of date` : text,
  };
}

/** KiCad ERC/DRC reports, rendered as the inspector's Checks section. */
export function ChecksView({
  threadRef,
  activity,
  design,
  results,
  sourceHash,
  canCheck,
  checking,
  jobRevision,
  error,
  loading,
  onRun,
  onCancel,
  canCancel = true,
  onLocate,
  showExcluded = false,
  onShowExcluded,
  activeId = null,
  onActivate,
  markers = true,
  onMarkers,
  findingStatus = "",
  orderedFindings,
  drawingSourceHash,
}: {
  threadRef: ScopedThreadRef;
  activity?: PcbCheckActivity | null;
  design: PcbDesign;
  results: Partial<Record<PcbCheckKind, PcbCheckResult>>;
  sourceHash: string | null;
  drawingSourceHash?: string | undefined;
  showExcluded?: boolean;
  onShowExcluded?: (enabled: boolean) => void;
  activeId?: string | null;
  onActivate?: (kind: PcbCheckKind, violation: PcbViolation) => void;
  markers?: boolean;
  onMarkers?: (enabled: boolean) => void;
  findingStatus?: string;
  orderedFindings?: readonly PcbFinding[];
  canCheck: boolean;
  checking: PcbCheckKind | null;
  jobRevision: number;
  error: string | null;
  loading: boolean;
  onRun: (kind: PcbCheckKind) => void;
  onCancel: () => void;
  canCancel?: boolean;
  onLocate?: (kind: PcbCheckKind, point: { x: number; y: number }, sheet?: string) => void;
}) {
  const [kind, setKind] = useState<PcbCheckKind>(design.schematicPath ? "erc" : "drc"),
    [severity, setSeverity] = useState<PcbViolation["severity"] | null>(null),
    [query, setQuery] = useState(""),
    [notice, setNotice] = useState<string | null>(null);
  const activeRow = useRef<HTMLDivElement>(null);
  const [previousActive, setPreviousActive] = useState<string | null>(null);
  if (activeId !== previousActive) {
    setPreviousActive(activeId);
    const target = (["erc", "drc"] as const).find((next) =>
      results[next]?.violations.some((v, index) => (v.id ?? `${next}-${index}`) === activeId),
    );
    if (target) {
      setKind(target);
      setQuery("");
      setSeverity(null);
    }
  }
  useEffect(() => {
    if (activeId) activeRow.current?.scrollIntoView?.({ block: "nearest" });
  }, [activeId]);
  const { isCopied, copyToClipboard } = useCopyToClipboard({
    target: "PCB check summary",
    onError: (error) => setNotice(error.message),
  });
  const available = (next: PcbCheckKind) =>
    next === "erc" ? !!design.schematicPath : !!design.boardPath;
  const isStale = (r: PcbCheckResult | undefined) =>
    !!r && (sourceHash === null || r.sourceHash !== sourceHash);
  const result = results[kind],
    stale = isStale(result);
  const needle = query.trim().toLowerCase();
  const findings =
    result?.violations.filter(
      (v) =>
        (showExcluded || !v.excluded) &&
        (!severity || v.severity === severity) &&
        (!needle ||
          `${v.type} ${v.description} ${v.sheet ?? ""} ${v.items.map((i) => i.description).join(" ")}`
            .toLowerCase()
            .includes(needle)),
    ) ?? [];
  const rules = new Map<string, PcbViolation[]>();
  for (const v of findings) rules.set(v.type, [...(rules.get(v.type) ?? []), v]);
  const run = (next: PcbCheckKind) => {
    setKind(next);
    setNotice(null);
    onRun(next);
  };
  const choose = (next: PcbCheckKind) => {
    setKind(next);
    setQuery("");
    setSeverity(null);
    setNotice(null);
  };
  const summary = result ? checkSummary(design, result, stale) : "";
  const prepare = () => {
    const drafts = useComposerDraftStore.getState();
    drafts.setPrompt(
      threadRef,
      appendSummary(drafts.getComposerDraft(threadRef)?.prompt ?? "", summary),
    );
    setNotice("Added to your draft.");
  };
  const current = status(result, checking === kind, stale);
  const findingId = (v: PcbViolation) => v.id ?? `${kind}-${result?.violations.indexOf(v) ?? -1}`;
  const located = orderedFindings?.some((f) => f.source === kind)
    ? orderedFindings
    : orderFindings(checkFindings(result, kind, { showExcluded }), []);
  const activeIndex = located.findIndex((f) => f.id === activeId);
  const activeStale = !!result && result.sourceHash !== (drawingSourceHash ?? sourceHash);
  const unit = useLengthUnit();
  const total = result ? result.counts.errors + result.counts.warnings + result.counts.excluded : 0;
  return (
    <>
      <Bar>
        <div className={k.checkCards} role="group" aria-label="Check type">
          {(["erc", "drc"] as const).map((next) => {
            const s = status(results[next], checking === next, isStale(results[next]));
            return (
              <button
                key={next}
                type="button"
                className={k.checkCard}
                aria-pressed={next === kind}
                disabled={!available(next)}
                onClick={() => choose(next)}
              >
                <span className={k.checkCardHead}>
                  <strong>{KINDS[next].name}</strong>
                  <small>{KINDS[next].surface}</small>
                </span>
                <span className={k.checkCardStatus}>
                  <span className={k.dot} data-tone={s.tone} aria-hidden="true" />
                  {available(next) ? s.text : `No ${KINDS[next].surface.toLowerCase()}`}
                </span>
              </button>
            );
          })}
        </div>
      </Bar>
      <Scroll>
        <AutoCheckSettings threadRef={threadRef} design={design} />
        {activity?.paused.map((pause) => (
          <Notice key={pause.kind} tone="warning">
            {pause.reason === "slow"
              ? `Automatic ${pause.kind.toUpperCase()} is paused because the last run took ${Math.round((pause.durationMs ?? 0) / 1000)} seconds. Run it from Checks to resume.`
              : `Automatic ${pause.kind.toUpperCase()} stopped after a failed run. It resumes after the next save.`}
          </Notice>
        ))}
        <label className={k.markerToggle}>
          <Switch
            checked={markers}
            onCheckedChange={(enabled) => onMarkers?.(enabled)}
            aria-label="Show on drawing"
          />
          Show on drawing
        </label>
        <p role="status" className={k.hint}>
          {activeIndex >= 0
            ? findingStatus || `Finding ${activeIndex + 1} of ${located.length}`
            : ""}
        </p>
        {!canCheck && (
          <Notice tone="warning">This connection needs permission to run terminal commands.</Notice>
        )}
        {checking && (
          <OperationStatus
            key={`${checking}:${jobRevision}`}
            label={`Checking ${checking === "erc" ? "schematic" : "board"}`}
            detail={
              activity?.running?.trigger === "auto"
                ? "Started after a save."
                : "KiCad processes one task at a time. A preview may finish first."
            }
            {...(canCancel ? { onCancel } : {})}
          />
        )}
        {loading && !result && <OperationStatus label="Loading previous checks" />}
        {error && (
          <p role="alert" className={k.error}>
            {error}
          </p>
        )}
        {!result && !loading && checking !== kind && (
          <EmptyState
            icon={<ShieldCheckIcon />}
            title={`${KINDS[kind].name} has not run`}
            action={
              <Button size="sm" disabled={!canCheck || !available(kind)} onClick={() => run(kind)}>
                <PlayIcon />
                Run {KINDS[kind].name}
              </Button>
            }
          >
            {kind === "erc"
              ? "Checks electrical connections and schematic rules on the saved design."
              : "Checks clearances, connections and schematic parity. Zones are used as saved and nothing is refilled."}
          </EmptyState>
        )}
        {result?.delta && (
          <>
            <p className={k.hint}>
              {result.delta.newCount} new, {result.delta.resolvedCount} resolved since the last run
              {result.delta.approximate ? " (approximate)" : ""}.
            </p>
            {result.delta.resolved.length > 0 && (
              <Group title="Resolved" meta={result.delta.resolvedCount} defaultOpen={false}>
                {result.delta.resolved.map((finding) => (
                  <p key={finding.id}>{finding.description}</p>
                ))}
              </Group>
            )}
          </>
        )}
        {result && (
          <>
            <div className={k.verdict} data-tone={current.tone}>
              <span className={k.verdictIcon} aria-hidden="true">
                {current.tone === "success" ? (
                  <CheckCircle2Icon />
                ) : current.tone === "error" ? (
                  <OctagonAlertIcon />
                ) : (
                  <TriangleAlertIcon />
                )}
              </span>
              <div className={k.verdictText}>
                <strong>
                  {result.outcome === "clean"
                    ? "No violations"
                    : result.outcome === "failed"
                      ? "Check failed to run"
                      : result.outcome === "timed-out"
                        ? "Check timed out"
                        : `${plural(result.counts.errors, "error")}, ${plural(result.counts.warnings, "warning")}`}
                </strong>
                <small>
                  <time dateTime={result.ranAt}>{new Date(result.ranAt).toLocaleString()}</time>
                  {result.kicadVersion ? ` · KiCad ${result.kicadVersion}` : ""}
                </small>
              </div>
              <Button
                size="xs"
                variant="outline"
                disabled={!canCheck || checking === kind}
                onClick={() => run(kind)}
              >
                <RotateCwIcon />
                Run again
              </Button>
            </div>
            {stale && (
              <Notice tone="warning" icon={<TriangleAlertIcon />}>
                {sourceHash
                  ? "Files changed since this run."
                  : "Live revision is unavailable. This report may be stale."}
              </Notice>
            )}
            {total > 0 && (
              <>
                <Stats>
                  <Stat
                    label="Errors"
                    tone="error"
                    value={result.counts.errors}
                    pressed={severity === "error"}
                    disabled={!result.counts.errors}
                    onClick={() => setSeverity(severity === "error" ? null : "error")}
                  />
                  <Stat
                    label="Warnings"
                    tone="warning"
                    value={result.counts.warnings}
                    pressed={severity === "warning"}
                    disabled={!result.counts.warnings}
                    onClick={() => setSeverity(severity === "warning" ? null : "warning")}
                  />
                  <Stat
                    label="Excluded"
                    ariaLabel="Show excluded"
                    value={result.counts.excluded}
                    pressed={showExcluded}
                    disabled={!result.counts.excluded}
                    onClick={() => onShowExcluded?.(!showExcluded)}
                  />
                </Stats>
                <SearchField
                  label="Filter rule violations"
                  placeholder="Filter rules, parts or sheets"
                  value={query}
                  onChange={setQuery}
                />
              </>
            )}
            {result.truncated && (
              <p className={k.hint}>
                Showing a bounded report. Open the full report in KiCad for all findings.
              </p>
            )}
            {rules.size > 0 && (
              <div className={k.groups}>
                {[...rules].map(([type, group]) => {
                  const worst = group.some((v) => v.severity === "error") ? "error" : "warning";
                  return (
                    <Group
                      key={type}
                      title={ruleName(type)}
                      meta={group.length}
                      defaultOpen={
                        group.some((v) => findingId(v) === activeId) ||
                        rules.size <= 4 ||
                        findings.length <= 20
                      }
                      lead={<span className={k.dot} data-tone={worst} aria-hidden="true" />}
                    >
                      {keyedRecords(group).map(({ value: v, key }) => (
                        <div
                          key={key}
                          ref={findingId(v) === activeId ? activeRow : undefined}
                          data-active={findingId(v) === activeId || undefined}
                          className={k.finding}
                          data-excluded={v.excluded || undefined}
                        >
                          <p>
                            {v.description}{" "}
                            {result.delta?.added.includes(findingId(v)) && (
                              <Badge variant="secondary" size="sm">
                                New
                              </Badge>
                            )}
                          </p>
                          {(v.group !== "violation" ||
                            v.excluded ||
                            v.sheet ||
                            (findingId(v) === activeId && activeStale)) && (
                            <div className={k.findingTags}>
                              {v.group === "parity" && (
                                <Badge variant="outline" size="sm">
                                  Schematic parity
                                </Badge>
                              )}
                              {v.group === "unconnected" && (
                                <Badge variant="outline" size="sm">
                                  Unconnected
                                </Badge>
                              )}
                              {v.excluded && (
                                <Badge variant="secondary" size="sm">
                                  Excluded
                                </Badge>
                              )}
                              {findingId(v) === activeId && activeStale && (
                                <Badge variant="outline" size="sm">
                                  Stale
                                </Badge>
                              )}
                              {v.sheet && <span>Sheet {v.sheet}</span>}
                            </div>
                          )}
                          {keyedRecords(v.items).map(({ value: item, key: itemKey }) => {
                            const located =
                              item.x !== undefined && item.y !== undefined
                                ? { x: item.x, y: item.y }
                                : null;
                            const pointMm = located;
                            const content = (
                              <>
                                <span>{item.description}</span>
                                {located && (
                                  <small className={k.mono}>
                                    {`${formatLength(located.x, unit, { unit: false })}, ${formatLength(located.y, unit)}`}
                                  </small>
                                )}
                              </>
                            );
                            return onLocate && pointMm ? (
                              <button
                                key={itemKey}
                                type="button"
                                className={k.location}
                                aria-label={`Go to ${item.description}`}
                                onClick={() => {
                                  onActivate?.(kind, v);
                                  onLocate(kind, pointMm, v.sheetId);
                                }}
                              >
                                <LocateFixedIcon aria-hidden="true" />
                                {content}
                              </button>
                            ) : (
                              <div key={itemKey} className={k.location}>
                                {content}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </Group>
                  );
                })}
              </div>
            )}
            {total > 0 && !findings.length && (
              <p className={k.hint}>
                {needle || severity
                  ? "No findings match this filter."
                  : "Every finding is excluded."}
              </p>
            )}
            {result.log && (
              <Log
                title={`Tool log${result.exitCode !== undefined ? ` (exit ${result.exitCode})` : ""}`}
                text={result.log}
                open={result.outcome === "failed" || result.outcome === "timed-out"}
              />
            )}
          </>
        )}
      </Scroll>
      {result && (
        <Footer>
          <p role="status" className={k.footerStatus}>
            {notice}
          </p>
          <Button variant="ghost" size="sm" onClick={() => copyToClipboard(summary, undefined)}>
            <CopyIcon />
            {isCopied ? "Copied" : "Copy summary"}
          </Button>
          <Button size="sm" variant="outline" onClick={prepare}>
            <MessageSquarePlusIcon />
            Add summary to draft
          </Button>
        </Footer>
      )}
    </>
  );
}
