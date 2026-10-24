import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { Atom, AsyncResult } from "effect/reactivity";
import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  slugId,
  type PcbDesign,
  type PcbInspection,
  type PcbEnclosureInput,
  type PcbEnclosureResult,
  type PcbReferenceResult,
  type AssemblyOperation,
} from "@t3tools/contracts/fork";
import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useServerConfigs } from "~/state/entities";
import { useRightPanelStore } from "~/rightPanelStore";
import { forkPanelSurface } from "../panels/registry";
import { models, runModelCommand } from "../model-preview-3d/state";
import { useAssembly } from "../model-preview-3d/useAssembly";
import { pcb } from "./state";
import { asyncValue, asyncError } from "./usePcbPreview";
import { Scroll, Section, Field, Notice, Group, errorText } from "./InspectorKit";
import { enclosureAssemblyPath, enclosureState } from "./enclosureState";
const idle = Atom.make(AsyncResult.initial<PcbEnclosureResult, never>());
const DIMENSIONS = [
  ["wallMm", "Wall", 2, 0.8, 10],
  ["floorMm", "Floor", 2, 0.8, 10],
  ["lidMm", "Lid", 2, 0.8, 10],
  ["sideGapMm", "Wall gap", 0.5, 0, 10],
  ["topGapMm", "Lid gap", 1, 0, 30],
  ["standoffHeightMm", "Standoff height", null, 0, 50],
  ["standoffDiameterMm", "Standoff diameter", null, 0.1, 20],
  ["pilotDiameterMm", "Pilot diameter", null, 0, 10],
  ["cornerRadiusMm", "Corner radius", 1, 0, 20],
  ["cutoutMarginMm", "Cutout margin", 0.5, 0, 5],
  ["lidLipMm", "Lid lip", 1.5, 0, 10],
  ["lidLipGapMm", "Lip gap", 0.2, 0, 2],
  ["assumedHeightMm", "Missing model height", 10, 0, 100],
] as const;
type Job = PcbEnclosureInput & { revision: number };
const boardReferencePath = (reference: PcbReferenceResult) => {
  if (!reference.relativePath)
    throw new Error(
      "This server did not return a workspace-relative board reference. Update the Loom server and retry.",
    );
  return reference.relativePath;
};
export function EnclosureTab({
  threadRef,
  design,
  inspection,
  sourceHash,
  executionAllowed,
}: {
  threadRef: ScopedThreadRef;
  design: PcbDesign;
  inspection: PcbInspection | null;
  sourceHash: string | null;
  executionAllowed: boolean;
}) {
  const configs = useServerConfigs(),
    features = loomFeaturesOf(configs.get(threadRef.environmentId)?.environment.capabilities),
    path = enclosureAssemblyPath(design.id),
    id = useId();
  const capability = enclosureState(features, null, sourceHash),
    assembly = useAssembly(threadRef, path, capability.assembly),
    snapshot = assembly.snapshot;
  const referencePath =
      snapshot?.assembly.parts.find((p) => p.id === snapshot.assembly.enclosure?.board)?.path ??
      null,
    status = enclosureState(features, referencePath, sourceHash);
  const allowed = useAtomValue(pcb.enclosure.permissionAtom(threadRef.environmentId)),
    canExport = useAtomValue(pcb.exportReference.permissionAtom(threadRef.environmentId)),
    canEdit = useAtomValue(models.updateAssembly.permissionAtom(threadRef.environmentId));
  const [values, setValues] = useState<Record<string, string>>({}),
    [output, setOutput] = useState(""),
    [python, setPython] = useState(false),
    [include, setInclude] = useState(""),
    [exclude, setExclude] = useState(""),
    [casePath, setCasePath] = useState(""),
    [previewJob, setPreviewJob] = useState<Job | null>(null),
    [job, setJob] = useState<Job | null>(null),
    [finished, setFinished] = useState<PcbEnclosureResult | null>(null),
    [error, setError] = useState<string | null>(null),
    [conflict, setConflict] = useState<Job | null>(null),
    [working, setWorking] = useState(false);
  const sequence = useRef(0),
    opened = useRef<PcbEnclosureResult | null>(null),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const result = useAtomValue(
    job && allowed && executionAllowed
      ? pcb.enclosure.resultAtom({ environmentId: threadRef.environmentId, input: job })
      : idle,
  );
  const listing = asyncValue(
    useAtomValue(
      models.models({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId },
      }),
    ),
  );
  const params: {
    -readonly [K in keyof NonNullable<PcbEnclosureInput["params"]>]: NonNullable<
      PcbEnclosureInput["params"]
    >[K];
  } = {};
  let valid = true;
  for (const [key, , defaultValue, min, max] of DIMENSIONS) {
    const text = values[key] ?? (defaultValue === null ? "" : String(defaultValue));
    const value = text.trim() ? Number(text) : null;
    if (value === null) {
      if (defaultValue !== null) valid = false;
      else params[key] = null;
    } else if (!Number.isFinite(value) || value < min || value > max) valid = false;
    else params[key] = value;
  }
  const refs = (s: string) => [...new Set(s.split(/[\s,]+/).filter(Boolean))];
  params.connectors = { include: refs(include), exclude: refs(exclude) };
  if (
    params.connectors.include.length > 16 ||
    params.connectors.exclude.length > 64 ||
    [...params.connectors.include, ...params.connectors.exclude].some((s) => s.length > 100)
  )
    valid = false;
  const input: PcbEnclosureInput = {
    threadId: threadRef.threadId,
    designId: design.id,
    params,
    ...(output.trim() ? { outputDir: output.trim() } : {}),
    build123d: python && status.python,
  };
  const previewResult = useAtomValue(
    previewJob && allowed && executionAllowed && valid
      ? pcb.enclosure.resultAtom({ environmentId: threadRef.environmentId, input: previewJob })
      : idle,
  );
  const preview = asyncValue(previewResult);
  const previewKey = JSON.stringify({ input, sourceHash });
  useEffect(() => {
    if (!allowed || !executionAllowed || !valid) {
      return;
    }
    const timer = setTimeout(() => {
      setPreviewJob({
        ...(JSON.parse(previewKey) as { input: PcbEnclosureInput }).input,
        preview: true,
        revision: ++sequence.current,
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [previewKey, allowed, executionAllowed, valid]);
  const open = (p: string) =>
    useRightPanelStore.getState().openSurface(threadRef, {
      ...forkPanelSurface("model-preview-3d", p),
      title: p.split("/").at(-1) ?? p,
    });
  if (job && (!allowed || !executionAllowed)) {
    setJob(null);
    setError("Generation stopped because execution is unavailable.");
  } else if (job && !result.waiting && result._tag !== "Initial") {
    const value = asyncValue(result),
      problem = asyncError(result);
    setJob(null);
    setError(problem);
    if (problem?.includes("was edited")) setConflict(job);
    if (value) {
      setConflict(null);
      setFinished(value);
    }
  }
  const afterGenerate = useEffectEvent((value: PcbEnclosureResult) => {
    void assembly.refresh();
    const destination =
      value.assembly?.path ?? value.files.find((f) => f.language === "openscad")?.path;
    if (destination) open(destination);
  });
  useEffect(() => {
    if (finished && opened.current !== finished) {
      opened.current = finished;
      afterGenerate(finished);
    }
  }, [finished]);
  const busy = !!job || working || assembly.busy,
    disabled = !allowed || !executionAllowed || busy;
  const generate = (overwrite = false) => {
    setError(null);
    setConflict(null);
    setJob({ ...input, overwrite, revision: ++sequence.current });
  };
  const updateBoard = async () => {
    if (working || !snapshot?.assembly.enclosure) return;
    const board = snapshot.assembly.enclosure.board;
    setWorking(true);
    setError(null);
    await runModelCommand(pcb.exportReference, {
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, designId: design.id },
    })
      .then((reference) =>
        assembly.apply([
          {
            op: "swap-board",
            id: board,
            path: boardReferencePath(reference),
          },
        ]),
      )
      .catch((cause: unknown) => {
        if (alive.current) setError(errorText(cause, "Could not update the board."));
      })
      .finally(() => {
        if (alive.current) setWorking(false);
      });
  };
  const applyCase = async () => {
    if (working || !casePath.trim()) return;
    setWorking(true);
    setError(null);
    await runModelCommand(pcb.exportReference, {
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, designId: design.id },
    })
      .then(async (reference) => {
        const ids = snapshot?.assembly.parts.map((p) => p.id) ?? [],
          board = snapshot?.assembly.enclosure?.board ?? slugId("board", ids),
          caseId = slugId("case", [...ids, board]);
        const operations: AssemblyOperation[] = [
          ...(snapshot?.assembly.enclosure
            ? [{ op: "swap-board" as const, id: board, path: boardReferencePath(reference) }]
            : [
                {
                  op: "add-part" as const,
                  id: board,
                  name: "Board",
                  path: boardReferencePath(reference),
                },
              ]),
          { op: "add-part", id: caseId, name: "Case", path: casePath.trim() },
          { op: "set-enclosure", board, parts: [caseId] },
          { op: "place-board", id: board },
        ];
        if (snapshot) await assembly.apply(operations);
        else
          await runModelCommand(models.updateAssembly, {
            environmentId: threadRef.environmentId,
            input: { file: { threadId: threadRef.threadId, path }, operations, createOnly: true },
          });
        if (alive.current) {
          await assembly.refresh();
          open(path);
        }
      })
      .catch((cause: unknown) => {
        if (alive.current) setError(errorText(cause, "Could not use this case."));
      })
      .finally(() => {
        if (alive.current) setWorking(false);
      });
  };
  if (!executionAllowed)
    return (
      <Scroll>
        <Notice>Circuit code must be allowed to generate a case.</Notice>
      </Scroll>
    );
  return (
    <Scroll>
      {!allowed && (
        <Notice>
          This connection does not permit running CAD tools to generate or update a case.
        </Notice>
      )}
      <Section title="Board reference">
        <p>
          The case follows this board's outline, mounting holes, component heights and edge
          connectors.
        </p>
        {inspection && (
          <p>
            {inspection.mountingHoles.length} holes, including{" "}
            {inspection.mountingHoles.filter((h) => h.plated).length} plated. Board thickness{" "}
            {inspection.thickness} mm.
          </p>
        )}
        {referencePath ? (
          <p>Reference {referencePath.split("/").at(-1)}</p>
        ) : (
          <p>Generate a case or choose an existing case to create a board reference.</p>
        )}
        {status.stale && (
          <Notice tone="warning">
            The board changed since this reference.
            <Button
              variant="outline"
              size="xs"
              disabled={disabled || !canExport || !canEdit || assembly.readOnly}
              onClick={() => void updateBoard()}
            >
              Update board
            </Button>
          </Notice>
        )}
        {design.kind === "kicad" &&
          design.toolStatus.version &&
          Number(design.toolStatus.version.match(/^\d+/)?.[0] ?? 0) < 10 && (
            <Notice tone="warning">KiCad 10 or newer is needed to export the 3D board.</Notice>
          )}
      </Section>
      <Section title="Case starter">
        <p>A tray, lid with a lip and screw bosses. All dimensions below are in millimetres.</p>
        <Group title="Case dimensions">
          {DIMENSIONS.map(([key, label, defaultValue, min, max]) => (
            <Field
              key={key}
              label={label}
              htmlFor={`${id}-${key}`}
              hint={
                defaultValue === null
                  ? "Leave blank to use the board's holes and component heights."
                  : undefined
              }
            >
              <Input
                id={`${id}-${key}`}
                type="number"
                size="sm"
                min={min}
                max={max}
                step={0.1}
                placeholder={defaultValue === null ? "Automatic" : undefined}
                value={values[key] ?? (defaultValue === null ? "" : String(defaultValue))}
                disabled={busy}
                onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
              />
            </Field>
          ))}
        </Group>
        <Group title="Connector overrides">
          <Field label="Include references" htmlFor={`${id}-include`}>
            <Input
              id={`${id}-include`}
              size="sm"
              value={include}
              placeholder="J1, USB1"
              onChange={(e) => setInclude(e.target.value)}
              disabled={busy}
            />
          </Field>
          <Field label="Exclude references" htmlFor={`${id}-exclude`}>
            <Input
              id={`${id}-exclude`}
              size="sm"
              value={exclude}
              onChange={(e) => setExclude(e.target.value)}
              disabled={busy}
            />
          </Field>
        </Group>
        <Field label="Output folder" htmlFor={`${id}-output`}>
          <Input
            id={`${id}-output`}
            size="sm"
            value={output}
            placeholder={path.replace(".loom-assembly.json", "-enclosure")}
            onChange={(e) => setOutput(e.target.value)}
            disabled={busy}
          />
        </Field>
        {status.python && (
          <label>
            <input
              type="checkbox"
              checked={python}
              onChange={(e) => setPython(e.target.checked)}
              disabled={busy}
            />{" "}
            Also create a build123d source
          </label>
        )}
        {preview && (
          <p>
            Case {preview.plan.outerMm.map((v) => v.toFixed(1)).join(" × ")} mm.{" "}
            {preview.plan.standoffs} standoffs. Connector cutouts:{" "}
            {preview.plan.cutouts.join(", ") || "none"}. Parts extend{" "}
            {preview.plan.partsAboveMm.toFixed(1)} mm above and{" "}
            {preview.plan.partsBelowMm.toFixed(1)} mm below the board.
          </p>
        )}
        {!previewJob?.preview || !previewResult.waiting ? (
          asyncError(previewResult) && <Notice tone="warning">{asyncError(previewResult)}</Notice>
        ) : (
          <p role="status">Preparing case dimensions…</p>
        )}
        {preview?.warnings.map((w) => (
          <Notice key={w}>{w}</Notice>
        ))}
        {!valid && <Notice tone="warning">Enter dimensions within the displayed ranges.</Notice>}
        {job ? (
          <Button
            variant="outline"
            size="xs"
            onClick={() => {
              setJob(null);
              setError("Generation cancelled. Completed files may remain in the workspace.");
            }}
          >
            Cancel generation
          </Button>
        ) : (
          <Button
            variant="outline"
            size="xs"
            disabled={disabled || !valid}
            onClick={() => generate()}
          >
            {finished ? "Regenerate case" : "Generate case"}
          </Button>
        )}
        {conflict && (
          <Notice tone="warning">
            A generated file was edited. Overwrite it?
            <Button
              variant="outline"
              size="xs"
              disabled={disabled}
              onClick={() => {
                setJob({ ...conflict, overwrite: true, revision: ++sequence.current });
                setConflict(null);
              }}
            >
              Overwrite edited file
            </Button>
            <Button variant="ghost" size="xs" onClick={() => setConflict(null)}>
              Cancel
            </Button>
          </Notice>
        )}
      </Section>
      {status.assembly && (
        <Section title="Board in case">
          {snapshot ? (
            <>
              <Button variant="outline" size="xs" onClick={() => open(path)}>
                Open assembly
              </Button>
              <Button
                variant="outline"
                size="xs"
                disabled={
                  !assembly.canCheck || busy || assembly.readOnly || !snapshot.assembly.enclosure
                }
                onClick={() => assembly.check()}
              >
                Check fit
              </Button>
              {assembly.checking && (
                <Button variant="outline" size="xs" onClick={assembly.cancel}>
                  Cancel check
                </Button>
              )}
              {assembly.report?.enclosure && (
                <p role="status">
                  {assembly.stale ? "Out of date: " : ""}
                  {assembly.report.enclosure.status}. Open the assembly's Fit tab for findings.
                </p>
              )}
              {assembly.canUndo && (
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={busy || assembly.readOnly}
                  onClick={() => {
                    setError(null);
                    void assembly.revert().catch((cause: unknown) => {
                      if (alive.current)
                        setError(errorText(cause, "Could not undo the board change."));
                    });
                  }}
                >
                  Undo board change
                </Button>
              )}
            </>
          ) : (
            <p>No assembly yet. Generation creates one beside the design.</p>
          )}
          <Field label="Use an existing case" htmlFor={`${id}-case`}>
            <Input
              id={`${id}-case`}
              size="sm"
              value={casePath}
              placeholder="models/case.stl"
              list={`${id}-models`}
              disabled={busy}
              onChange={(e) => setCasePath(e.target.value)}
            />
            <datalist id={`${id}-models`}>
              {listing?.models
                .filter((m) => !/\.loom\/pcb-references\//.test(m.path))
                .map((m) => (
                  <option key={m.path} value={m.path} />
                ))}
            </datalist>
          </Field>
          <Button
            variant="outline"
            size="xs"
            disabled={disabled || !canExport || !canEdit || !casePath.trim() || snapshot?.readOnly}
            onClick={() => void applyCase()}
          >
            Use case and centre board
          </Button>
        </Section>
      )}
      {finished?.files.map((f) => (
        <p key={f.path}>{f.path}</p>
      ))}
      {(error ||
        (snapshot
          ? assembly.error
          : assembly.error?.includes("deleted or moved")
            ? null
            : assembly.error)) && (
        <Notice tone="error" role="alert">
          {error ?? assembly.error}
        </Notice>
      )}
    </Scroll>
  );
}
