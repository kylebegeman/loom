import { randomUUID } from "~/lib/utils";
import { useEffect, useId, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { Atom, AsyncResult } from "effect/reactivity";
import {
  ArrowDownUpIcon,
  GitCompareArrowsIcon,
  MinusIcon,
  PencilIcon,
  PlusIcon,
} from "lucide-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { PcbComparison } from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { pcb } from "./state";
import { asyncError, asyncValue } from "./usePcbPreview";
import { OperationStatus } from "./OperationStatus";
import {
  EmptyState,
  Footer,
  Group,
  Notice,
  Range,
  Scroll,
  Section,
  Segmented,
  Stat,
  Stats,
} from "./InspectorKit";
import { ToolButton } from "./ToolButton";
import k from "./inspector.module.css";

const idleComparison = Atom.make(AsyncResult.initial<PcbComparison, never>());
type Change = PcbComparison["changes"][number]["kind"];
type Mode = "overlay" | "before" | "after" | "difference";
const CHANGE = {
  added: { title: "Added", icon: PlusIcon, tone: "success" },
  removed: { title: "Removed", icon: MinusIcon, tone: "error" },
  changed: { title: "Changed", icon: PencilIcon, tone: "warning" },
} as const;
const shortRef = (ref: string) => (/^[0-9a-f]{12,}$/i.test(ref) ? ref.slice(0, 8) : ref);

export function RevisionCompare({
  threadRef,
  designId,
  onSelect,
}: {
  threadRef: ScopedThreadRef;
  designId: string;
  onSelect: (reference: string) => void;
}) {
  const listId = useId();
  const revisions = asyncValue(
    useAtomValue(
      pcb.revisions({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, designId },
      }),
    ),
  );
  const [from, setFrom] = useState("HEAD"),
    [to, setTo] = useState(""),
    [comparison, setComparison] = useState<PcbComparison | null>(null),
    [job, setJob] = useState<{ from: string; to: string; revision: string } | null>(null),
    [error, setError] = useState<string | null>(null),
    [opacity, setOpacity] = useState(0.5),
    [mode, setMode] = useState<Mode>("overlay"),
    [filter, setFilter] = useState<Change | null>(null);
  const canCompare = useAtomValue(pcb.compare.permissionAtom(threadRef.environmentId));
  if (job && !canCompare) setJob(null);
  const response = useAtomValue(
    job && canCompare
      ? pcb.compare.resultAtom({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, designId, ...job },
        })
      : idleComparison,
  );
  const busy = job !== null && (response.waiting || response._tag === "Initial");
  const completed = asyncValue(response);
  if (job && !response.waiting && response._tag !== "Initial") {
    if (completed) {
      setComparison(completed);
      setFilter(null);
    }
    setError(asyncError(response));
    setJob(null);
  }
  const compare = () => {
    if (!busy && canCompare && from.trim()) {
      setError(null);
      setJob({ from: from.trim(), to: to.trim(), revision: randomUUID() });
    }
  };
  const label = (ref: string) =>
    ref ? (revisions?.find((r) => r.ref === ref)?.label ?? shortRef(ref)) : "Working tree";
  const counts = { added: 0, removed: 0, changed: 0 };
  for (const c of comparison?.changes ?? []) counts[c.kind]++;
  return (
    <>
      <Scroll>
        <Section title="Revisions">
          <div className={k.revisionPair}>
            <div className={k.revisionField}>
              <span className={k.revisionTag}>From</span>
              <Input
                size="sm"
                font="mono"
                aria-label="Before revision"
                list={listId}
                placeholder="Commit or checkpoint"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <ToolButton
              className={k.swap}
              label="Swap revisions"
              disabled={!to.trim()}
              onClick={() => {
                setFrom(to);
                setTo(from);
              }}
            >
              <ArrowDownUpIcon />
            </ToolButton>
            <div className={k.revisionField}>
              <span className={k.revisionTag}>To</span>
              <Input
                size="sm"
                font="mono"
                aria-label="After revision"
                list={listId}
                placeholder="Working tree"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>
          <datalist id={listId}>
            {revisions?.map((r) => (
              <option key={r.ref} value={r.ref}>
                {r.label}
              </option>
            ))}
          </datalist>
          {revisions && revisions.length > 0 && (
            <div className={k.recent}>
              <span className={k.fieldHint}>Recent</span>
              <div className={k.chips}>
                {revisions.slice(0, 6).map((r) => (
                  <button
                    key={r.ref}
                    type="button"
                    className={k.revisionChip}
                    aria-pressed={from === r.ref}
                    onClick={() => setFrom(r.ref)}
                  >
                    <span className={k.mono}>{shortRef(r.ref)}</span>
                    {r.label && r.label !== r.ref && <small>{r.label}</small>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Section>
        {!canCompare && (
          <Notice tone="warning">Comparison needs terminal permission on this environment.</Notice>
        )}
        {busy && (
          <OperationStatus
            label="Comparing design revisions"
            detail="Reading saved sources and exporting aligned board drawings."
            onCancel={() => setJob(null)}
          />
        )}
        {error && (
          <p role="alert" className={k.error}>
            {error}
          </p>
        )}
        {!comparison && !busy && !error && (
          <EmptyState icon={<GitCompareArrowsIcon />} title="Pick two revisions">
            Compare a commit or checkpoint against another, or against the files as they are now.
            Changed parts and an aligned board overlay appear here.
          </EmptyState>
        )}
        {comparison && (
          <>
            <Section title="Result" count={`${label(comparison.from)} → ${label(comparison.to)}`}>
              <Stats>
                {(["added", "removed", "changed"] as const).map((kind) => (
                  <Stat
                    key={kind}
                    label={CHANGE[kind].title}
                    tone={CHANGE[kind].tone}
                    value={counts[kind]}
                    pressed={filter === kind}
                    disabled={!counts[kind]}
                    onClick={() => setFilter(filter === kind ? null : kind)}
                  />
                ))}
              </Stats>
            </Section>
            {comparison.beforeSvg && comparison.afterSvg && (
              <Section title="Board">
                <Segmented
                  label="Comparison"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: "overlay", label: "Overlay" },
                    { value: "before", label: "Before" },
                    { value: "after", label: "After" },
                    { value: "difference", label: "Difference" },
                  ]}
                />
                <ComparisonImages
                  before={comparison.beforeSvg}
                  after={comparison.afterSvg}
                  mode={mode}
                  opacity={opacity}
                />
                {mode === "overlay" && (
                  <div className={k.rangeRow}>
                    <span>Before</span>
                    <Range
                      label="After opacity"
                      min={0}
                      max={1}
                      step={0.05}
                      value={opacity}
                      onChange={setOpacity}
                    />
                    <span>After</span>
                  </div>
                )}
              </Section>
            )}
            {comparison.changes.length ? (
              <div className={k.groups}>
                {(["added", "removed", "changed"] as const)
                  .filter((kind) => counts[kind] && (!filter || filter === kind))
                  .map((kind) => {
                    const Icon = CHANGE[kind].icon;
                    return (
                      <Group key={kind} title={CHANGE[kind].title} meta={counts[kind]}>
                        {comparison.changes
                          .filter((c) => c.kind === kind)
                          .map((c) => (
                            <button
                              key={`${c.kind}:${c.reference}`}
                              type="button"
                              className={k.item}
                              onClick={() => onSelect(c.reference)}
                            >
                              <span
                                className={k.iconTile}
                                data-tone={CHANGE[kind].tone}
                                aria-hidden="true"
                              >
                                <Icon />
                              </span>
                              <span className={k.itemText}>
                                <strong className={k.mono}>{c.reference}</strong>
                                {c.detail && <small>{c.detail}</small>}
                              </span>
                            </button>
                          ))}
                      </Group>
                    );
                  })}
              </div>
            ) : (
              <p className={k.hint}>No component, placement, footprint or pin-net changes found.</p>
            )}
          </>
        )}
      </Scroll>
      <Footer>
        <Button
          size="sm"
          className="flex-1"
          disabled={busy || !canCompare || !from.trim()}
          onClick={compare}
        >
          <GitCompareArrowsIcon />
          {comparison ? "Compare again" : "Compare revisions"}
        </Button>
      </Footer>
    </>
  );
}
function ComparisonImages({
  before,
  after,
  mode,
  opacity,
}: {
  before: string;
  after: string;
  mode: Mode;
  opacity: number;
}) {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const values = [before, after].map((svg) =>
      URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })),
    );
    // Publish the newly allocated Blob URL; cleanup releases the external image resource.
    // eslint-disable-next-line react/set-state-in-effect
    setUrls(values);
    return () => values.forEach((url) => URL.revokeObjectURL(url));
  }, [before, after]);
  return (
    <div className={k.comparison} data-mode={mode}>
      {urls[0] && mode !== "after" && <img src={urls[0]} alt="Previous board revision" />}
      {urls[1] && mode !== "before" && (
        <img
          src={urls[1]}
          alt="Current board revision"
          style={{
            opacity: mode === "overlay" ? opacity : 1,
            mixBlendMode: mode === "difference" ? "difference" : "normal",
          }}
        />
      )}
    </div>
  );
}
