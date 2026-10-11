import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { Atom, AsyncResult } from "effect/reactivity";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type {
  PcbBoardStats,
  PcbDesign,
  PcbFabCatalog,
  PcbFabCheckResult,
} from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { pcb } from "./state";
import { asyncError } from "./usePcbPreview";
import { FabCapabilitiesDialog } from "./FabCapabilitiesDialog";
import { Scroll, Group, Notice } from "./InspectorKit";
import { fabSummaryText } from "./fabCapabilities.logic";
import { useLengthUnit } from "./preferences";
import { formatLength } from "./length";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useComposerDraftStore } from "~/composerDraftStore";
import { appendSummary } from "./summary";
import k from "./inspector.module.css";
const idle = Atom.make(AsyncResult.initial<PcbFabCheckResult, never>());
export function FabCheckView({
  threadRef,
  design,
  result,
  catalog,
  fabId,
  onFabId,
  sourceHash,
  loading,
  error,
  onRefresh,
  onLocate,
  onDrc,
  boardStats,
  showExcluded = false,
}: {
  threadRef: ScopedThreadRef;
  design: PcbDesign;
  result: PcbFabCheckResult | null;
  catalog: PcbFabCatalog | null;
  fabId: string | undefined;
  onFabId: (id: string) => void;
  sourceHash: string | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onLocate: (point: { x: number; y: number }, description?: string) => void;
  onDrc: () => void;
  boardStats?: PcbBoardStats | null | undefined;
  showExcluded?: boolean | undefined;
}) {
  const allowed = useAtomValue(pcb.fabCheck.permissionAtom(threadRef.environmentId));
  const [job, setJob] = useState<number | null>(null),
    [revision, setRevision] = useState(0),
    [runError, setRunError] = useState<string | null>(null),
    [manage, setManage] = useState(false),
    [notice, setNotice] = useState<string | null>(null);
  const state = useAtomValue(
    job !== null && allowed && fabId
      ? pcb.fabCheck.resultAtom({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, designId: design.id, fabId, revision: job },
        })
      : idle,
  );
  if (job !== null && !state.waiting && state._tag !== "Initial") {
    setJob(null);
    setRunError(asyncError(state));
  }
  const copy = useCopyToClipboard({
      target: "Fab check summary",
      onError: (cause) => setNotice(cause.message),
    }),
    unit = useLengthUnit();
  const selected = catalog
    ? [...catalog.builtIns, ...catalog.entries].find((e) => e.id === fabId)
    : undefined;
  const limitsChanged =
      !!result && !!selected && JSON.stringify(result.capability) !== JSON.stringify(selected),
    stale = !!result && result.sourceHash !== sourceHash;
  const run = () => {
    setRunError(null);
    setRevision((n) => n + 1);
    setJob(revision + 1);
  };

  return (
    <Scroll>
      <label>
        Fab
        <select
          aria-label="Fab profile"
          value={fabId ?? ""}
          disabled={!catalog || job !== null}
          onChange={(e) => onFabId(e.target.value)}
        >
          {[...(catalog?.builtIns ?? []), ...(catalog?.entries ?? [])].map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} ({f.tier})
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        {job !== null ? (
          <Button size="sm" variant="outline" onClick={() => setJob(null)}>
            Cancel
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={
              !allowed ||
              !design.toolAvailable ||
              design.kind !== "kicad" ||
              !design.boardPath ||
              !fabId
            }
            onClick={run}
          >
            Run fab check
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => setManage(true)}>
          Fab capabilities…
        </Button>
      </div>
      <p className={k.hint}>Runs DRC with this fab's limits on a copy of the board.</p>
      {design.kind !== "kicad" || !design.boardPath ? (
        <Notice>Fab checks need a KiCad board.</Notice>
      ) : !allowed ? (
        <Notice tone="warning">This connection needs permission to run terminal commands.</Notice>
      ) : !design.toolAvailable ? (
        <Notice tone="warning">Install KiCad 9 or newer on the environment host.</Notice>
      ) : null}
      {job !== null && (
        <p role="status">Checking against {selected?.name}. KiCad processes one task at a time.</p>
      )}
      {(runError || error) && <Notice tone="error">{runError ?? error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {loading ? (
        <p role="status">Loading previous fab check</p>
      ) : !result ? (
        <p>No fab check yet</p>
      ) : (
        <>
          {stale && <Notice tone="warning">This result is out of date.</Notice>}
          {limitsChanged && <Notice tone="warning">Limits changed since this check.</Notice>}
          <p role="status">
            <strong>
              {result.outcome === "clean"
                ? `Fits ${result.capability.name}`
                : result.outcome === "failed"
                  ? "Fab check failed"
                  : result.outcome === "timed-out"
                    ? "Fab check timed out"
                    : `${result.counts.errors + result.counts.warnings + result.boardFindings.length} problems for ${result.capability.name}`}
            </strong>
          </p>
          {!result.zonesRefilled && <Notice>Zones were checked as last filled in KiCad.</Notice>}
          {result.boardFindings.map((f) => (
            <Notice key={f.id} tone={f.severity === "error" ? "error" : "warning"}>
              {f.message}
            </Notice>
          ))}
          <Group title="Limits">
            {Object.entries({
              Track: result.capability.minTrackMm,
              Space: result.capability.minSpaceMm,
              Drill: result.capability.minDrillMm,
              "Annular ring": result.capability.minAnnularRingMm,
              "Via pad": result.capability.minViaMm,
              "Edge clearance": result.capability.minEdgeClearanceMm,
              "Hole to hole": result.capability.minHoleToHoleMm,
            }).map(([label, mm]) => (
              <p key={label}>
                {label}:{" "}
                {mm === null ? "Not published" : formatLength(mm, unit, { digits: 4, trim: true })}
              </p>
            ))}
            {boardStats && (
              <p>
                Measured minimums: track{" "}
                {boardStats.measured.track === null
                  ? "unknown"
                  : formatLength(boardStats.measured.track, unit, { digits: 4, trim: true })}
                ; drill{" "}
                {boardStats.measured.drill === null
                  ? "unknown"
                  : formatLength(boardStats.measured.drill, unit, { digits: 4, trim: true })}
                ; via{" "}
                {boardStats.measured.viaDiameter === null
                  ? "unknown"
                  : formatLength(boardStats.measured.viaDiameter, unit, { digits: 4, trim: true })}
                ; annular ring{" "}
                {boardStats.measured.annularRing === null
                  ? "unknown"
                  : formatLength(boardStats.measured.annularRing, unit, { digits: 4, trim: true })}
                .
              </p>
            )}
            <p>{result.capability.notes}</p>
            <p>Checked {result.capability.checkedOn}</p>
            {/^https?:\/\//.test(result.capability.sourceUrl) && (
              <a href={result.capability.sourceUrl} target="_blank" rel="noreferrer">
                Source
              </a>
            )}
          </Group>
          {result.violations
            .filter((v) => showExcluded || !v.excluded)
            .map((v) => (
              <div
                key={
                  v.id ??
                  `${v.rule}:${v.description}:${v.items.map((i) => `${i.x}:${i.y}`).join(";")}`
                }
                className={k.section}
              >
                <strong>
                  {v.rule}: {v.description}
                </strong>
                {v.measuredMm !== undefined && (
                  <p>
                    Measured {formatLength(v.measuredMm, unit, { digits: 4, trim: true })}
                    {v.limitMm !== undefined
                      ? `; limit ${formatLength(v.limitMm, unit, { digits: 4, trim: true })}`
                      : ""}
                  </p>
                )}
                {v.excluded && <p>Excluded</p>}
                {v.items.find((i) => i.x !== undefined && i.y !== undefined) && (
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => {
                      const point = v.items.find((i) => i.x !== undefined && i.y !== undefined)!;
                      onLocate({ x: point.x!, y: point.y! }, v.description);
                    }}
                  >
                    Locate
                  </Button>
                )}
              </div>
            ))}
          {result.notChecked.length > 0 && (
            <Notice>Not checked: {result.notChecked.join(", ")}</Notice>
          )}
          {result.alsoInDrc > 0 && (
            <Button variant="outline" size="xs" onClick={onDrc}>
              Also in DRC: {result.alsoInDrc} other findings
            </Button>
          )}
          <Group title="Cost drivers">
            {result.costDrivers.length ? (
              result.costDrivers.map((driver) => (
                <div key={driver.id}>
                  <strong>{driver.title}</strong>
                  <p>{driver.detail}</p>
                  {driver.sourceUrl && (
                    <a href={driver.sourceUrl} target="_blank" rel="noreferrer">
                      Source
                    </a>
                  )}
                </div>
              ))
            ) : (
              <p>No listed cost drivers. This is not a quote.</p>
            )}
          </Group>
          {result.truncated && <Notice>Showing the first 500 findings.</Notice>}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="xs"
              onClick={() => copy.copyToClipboard(fabSummaryText(result), undefined)}
            >
              {copy.isCopied ? "Copied" : "Copy summary"}
            </Button>
            <Button
              variant="outline"
              size="xs"
              onClick={() => {
                const drafts = useComposerDraftStore.getState();
                drafts.setPrompt(
                  threadRef,
                  appendSummary(
                    drafts.getComposerDraft(threadRef)?.prompt ?? "",
                    fabSummaryText(result),
                  ),
                );
                setNotice("Added to your draft.");
              }}
            >
              Add to draft
            </Button>
          </div>
          {result.log && (
            <Group title="Log">
              <pre>{result.log}</pre>
            </Group>
          )}
        </>
      )}
      <FabCapabilitiesDialog
        environmentId={threadRef.environmentId}
        open={manage}
        onOpenChange={(value) => {
          setManage(value);
          if (!value) onRefresh();
        }}
      />
    </Scroll>
  );
}
