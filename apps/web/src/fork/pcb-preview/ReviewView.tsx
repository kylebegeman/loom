import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import { Atom, AsyncResult } from "effect/reactivity";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type {
  PcbDesign,
  PcbReviewResult,
  PcbReviewLocation,
  PcbUpdateProjectSettingsInput,
} from "@t3tools/contracts/fork";
import { pcb } from "./state";
import { asyncValue, asyncError } from "./usePcbPreview";
import { runModelCommand } from "../model-preview-3d/state";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { Input } from "~/components/ui/input";
import { Scroll, Notice, Group, useWrite } from "./InspectorKit";
import { AutoCheckSettings } from "./AutoCheckSettings";
import { usePcbPreferences } from "./preferences";
import k from "./inspector.module.css";
const RULES = [
  ["i2c-pullup", "I2C pull-ups"],
  ["decoupling", "Decoupling"],
  ["connector-esd", "Connector ESD"],
  ["floating-input", "Floating inputs"],
  ["reset-pullup", "Reset bias"],
  ["led-resistor", "LED resistors"],
  ["multiple-drivers", "Multiple drivers"],
  ["regulator-ratings", "Regulator ratings"],
] as const;
const idle = Atom.make(AsyncResult.initial<PcbReviewResult, never>());
export function ReviewView({
  threadRef,
  design,
  result,
  loading,
  error,
  sourceHash,
  onRefresh,
  onLocate,
}: {
  threadRef: ScopedThreadRef;
  design: PcbDesign;
  result: PcbReviewResult | null;
  loading: boolean;
  error: string | null;
  sourceHash: string | null;
  onRefresh: () => void;
  onLocate: (surface: "schematic" | "pcb", point: PcbReviewLocation, sheet?: string) => void;
}) {
  const target = {
    environmentId: threadRef.environmentId,
    input: { threadId: threadRef.threadId, designId: design.id },
  };
  const allowed = useAtomValue(pcb.review.permissionAtom(threadRef.environmentId));
  const canSave = useAtomValue(pcb.updateProjectSettings.permissionAtom(threadRef.environmentId));
  const settings = asyncValue(
    useAtomValue(
      pcb.projectSettings({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId },
      }),
    ),
  );
  const write = useWrite("Review settings could not be saved.");
  const [job, setJob] = useState<number | null>(null),
    [revision, setRevision] = useState(0),
    [runError, setRunError] = useState<string | null>(null);
  const [ignore, setIgnore] = useState<string | null>(null),
    [note, setNote] = useState("");
  const show = usePcbPreferences((s) => s.reviewShowWaived),
    setShow = usePcbPreferences((s) => s.setReviewShowWaived);
  const state = useAtomValue(
    job !== null && allowed
      ? pcb.review.resultAtom({ ...target, input: { ...target.input, revision: job } })
      : idle,
  );
  if (job !== null && !state.waiting && state._tag !== "Initial") {
    setJob(null);
    setRunError(asyncError(state));
  }
  const run = () => {
    setRunError(null);
    setRevision((n) => n + 1);
    setJob(revision + 1);
  };
  const patch = (review: NonNullable<PcbUpdateProjectSettingsInput["review"]>) =>
    void write.run(async () => {
      await runModelCommand(pcb.updateProjectSettings, {
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, review },
      });
      onRefresh();
      if (review.rules || review.params) run();
    });
  const stale = !!result && result.sourceHash !== sourceHash;
  const configChanged =
    !!result && result.rules.some((r) => r.enabled !== (settings?.review.rules[r.id] ?? true));
  return (
    <Scroll>
      <AutoCheckSettings threadRef={threadRef} design={design} />
      <p className={k.hint}>
        Deterministic heuristics for common mistakes ERC does not catch. Review findings may need a
        datasheet or design judgment.
      </p>
      {!allowed && (
        <Notice tone="warning">This connection needs permission to run terminal commands.</Notice>
      )}
      {design.kind === "kicad" && !design.schematicPath && (
        <Notice>This design has no schematic to review.</Notice>
      )}
      <div className="flex gap-2">
        {job !== null ? (
          <Button size="sm" variant="outline" onClick={() => setJob(null)}>
            Cancel
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={!allowed || (design.kind === "kicad" && !design.schematicPath)}
            onClick={run}
          >
            Run review
          </Button>
        )}
      </div>
      {job !== null && <p role="status">Reviewing schematic</p>}
      {(runError || error || write.error) && (
        <Notice tone="error">{runError ?? error ?? write.error}</Notice>
      )}
      <Group title="Rules">
        <div>
          {RULES.map(([id, title]) => (
            <label key={id} className={k.markerToggle}>
              <Switch
                aria-label={title}
                checked={settings?.review.rules[id] ?? true}
                disabled={!settings || !canSave || write.busy}
                onCheckedChange={(value) => patch({ rules: { [id]: value } })}
              />
              {title}
              {settings?.review.rules[id] === false && <small>Off for this project</small>}
            </label>
          ))}
          <label>
            Decoupling distance (1 to 50 mm)
            <Input
              size="sm"
              type="number"
              min={1}
              max={50}
              defaultValue={settings?.review.params.decoupling?.maxDistanceMm ?? 5}
              key={String(settings?.review.params.decoupling?.maxDistanceMm)}
              disabled={!canSave || write.busy}
              onBlur={(event) => {
                const value = Number(event.currentTarget.value);
                if (value !== (settings?.review.params.decoupling?.maxDistanceMm ?? 5))
                  patch({ params: { decoupling: { maxDistanceMm: value } } });
              }}
            />
          </label>
          <label>
            Connector scope
            <select
              aria-label="Connector scope"
              value={String(settings?.review.params["connector-esd"]?.scope ?? "usb")}
              disabled={!canSave || write.busy}
              onChange={(event) =>
                patch({ params: { "connector-esd": { scope: event.target.value } } })
              }
            >
              <option value="usb">USB only</option>
              <option value="all-connectors">All connectors</option>
            </select>
          </label>
        </div>
      </Group>
      {loading ? (
        <p role="status">Loading previous review</p>
      ) : !result ? (
        <p>Review this design for common mistakes ERC does not catch.</p>
      ) : (
        <>
          {(stale || configChanged) && (
            <Notice tone="warning">
              {stale ? "Review is out of date." : "Rules changed since this review. Run again."}
            </Notice>
          )}
          {result.notices.map((n) => (
            <Notice key={n}>{n}</Notice>
          ))}
          <p role="status">
            {result.outcome === "clean"
              ? "No review findings."
              : `${result.counts.errors + result.counts.warnings + result.counts.info} review findings.`}{" "}
            {result.rules.filter((r) => r.enabled).length} rules ran.{" "}
            {result.rules.filter((r) => !r.enabled).length} off for this project.
          </p>
          <label className={k.markerToggle}>
            <Switch
              aria-label="Show ignored review findings"
              checked={show}
              onCheckedChange={setShow}
            />
            Show ignored ({result.counts.waived})
          </label>
          {result.rules.map((rule) => (
            <Group key={rule.id} title={rule.title}>
              {rule.limited && <p className={k.hint}>{rule.limited}</p>}
              {result.findings
                .filter((f) => f.rule === rule.id && (show || !f.waived))
                .map((f) => (
                  <div key={f.id} className={k.section}>
                    <strong>
                      {f.severity === "info"
                        ? "Note"
                        : f.severity === "error"
                          ? "Error"
                          : "Warning"}
                      : {f.message}
                    </strong>
                    <p>Why: {f.why}</p>
                    <p>{f.fix}</p>
                    <p className={k.hint}>
                      {f.parts.join(", ")}
                      {f.waiverNote ? ` · Ignored: ${f.waiverNote}` : ""}
                    </p>
                    <div className="flex gap-2">
                      {(f.schematic || f.board) && (
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => {
                            const point = f.schematic ?? f.board!;
                            onLocate(f.schematic ? "schematic" : "pcb", point, point.sheet);
                          }}
                        >
                          Locate
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={!canSave || write.busy}
                        onClick={() => {
                          if (f.waived)
                            patch({ unwaive: [{ designId: design.id, findingId: f.id }] });
                          else {
                            setIgnore(f.id);
                            setNote("");
                          }
                        }}
                      >
                        {f.waived ? "Stop ignoring" : "Ignore here"}
                      </Button>
                    </div>
                    {ignore === f.id && (
                      <div>
                        <label>
                          Optional note
                          <Input
                            size="sm"
                            value={note}
                            maxLength={200}
                            onChange={(e) => setNote(e.target.value)}
                          />
                        </label>
                        <Button
                          size="xs"
                          disabled={!canSave || write.busy}
                          onClick={() => {
                            patch({
                              waive: [
                                { designId: design.id, findingId: f.id, ...(note ? { note } : {}) },
                              ],
                            });
                            setIgnore(null);
                          }}
                        >
                          Ignore finding
                        </Button>
                        <Button size="xs" variant="ghost" onClick={() => setIgnore(null)}>
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
            </Group>
          ))}
          {result.truncated && <Notice>Showing the first 500 findings.</Notice>}
        </>
      )}
    </Scroll>
  );
}
