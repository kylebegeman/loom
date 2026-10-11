import { useEffect, useRef, useState } from "react";
import { useAtomValue, useAtomRefresh } from "@effect/atom-react";
import { Atom, AsyncResult } from "effect/reactivity";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type {
  PcbDesign,
  PcbFabPackageInput,
  PcbFabPackageResult,
  PcbFabPackageZip,
  PcbFabPreviewLayer,
} from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { useAtomCommand } from "~/state/use-atom-command";
import { serverEnvironment } from "~/state/server";
import { shellEnvironment } from "~/state/shell";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { isElectron } from "~/env";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { modelUrl } from "../model-preview-3d/state";
import { pcb } from "./state";
import { asyncValue, asyncError } from "./usePcbPreview";
import { Scroll, Group, Notice } from "./InspectorKit";
import { OperationStatus } from "./OperationStatus";
import { groupOutputs, isPackageStale, checklistText } from "./fabPackage.logic";
const verdictLabel = { ready: "Ready", "needs-review": "Needs review", "not-ready": "Not ready" };
const statusLabel = {
  pass: "Pass",
  fail: "Needs attention",
  warning: "Warning",
  manual: "Check manually",
  skipped: "Skipped",
};
const idleZip = Atom.make(AsyncResult.initial<PcbFabPackageZip, never>());
const idle = Atom.make(AsyncResult.initial<PcbFabPackageResult, never>());
export type FabOutputPreview = {
  id: string;
  sourceHash: string;
  layers: readonly PcbFabPreviewLayer[];
};
export function FabricationTab({
  threadRef,
  design,
  sourceHash,
  executionAllowed,
  onPreview,
}: {
  threadRef: ScopedThreadRef;
  design: PcbDesign;
  sourceHash: string | null;
  executionAllowed: boolean;
  onPreview: (value: FabOutputPreview) => void;
}) {
  const target = {
    environmentId: threadRef.environmentId,
    input: { threadId: threadRef.threadId, designId: design.id },
  };
  const listState = useAtomValue(pcb.fabPackages(target)),
    catalog = asyncValue(
      useAtomValue(pcb.fabCapabilities({ environmentId: threadRef.environmentId, input: {} })),
    );
  const [profile, setProfile] = useState<"generic" | "jlcpcb">("generic"),
    [selectedFab, setFabId] = useState<string | null>(null),
    [assembly, setAssembly] = useState(true),
    [force, setForce] = useState(false),
    [revision, setRevision] = useState(0),
    [job, setJob] = useState<(PcbFabPackageInput & { revision: number }) | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [finished, setFinished] = useState<PcbFabPackageResult | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const allowed = useAtomValue(pcb.fabPackage.permissionAtom(threadRef.environmentId)),
    canDelete = useAtomValue(pcb.deleteFabPackage.permissionAtom(threadRef.environmentId)),
    canOpen = useAtomValue(shellEnvironment.openInEditor.permissionAtom(threadRef.environmentId));
  const state = useAtomValue(
    job && allowed
      ? pcb.fabPackage.resultAtom({ environmentId: threadRef.environmentId, input: job })
      : idle,
  );
  if (job && (!allowed || !executionAllowed)) {
    setJob(null);
    setError("Package creation stopped because execution is unavailable.");
  }
  if (job && !state.waiting && state._tag !== "Initial") {
    setJob(null);
    setError(asyncError(state));
    const value = asyncValue(state);
    if (value) {
      setSelected(value.id);
      setFinished(value);
    }
  }
  const getZip = useAtomCommand(pcb.fabPackageZip, { reportFailure: false }),
    remove = useAtomCommand(pcb.deleteFabPackage, { reportFailure: false }),
    open = useAtomCommand(shellEnvironment.openInEditor, { reportFailure: false });
  const primary = usePrimaryEnvironmentId(),
    config = useAtomValue(serverEnvironment.configValueAtom(threadRef.environmentId)),
    showOpen =
      isElectron &&
      primary === threadRef.environmentId &&
      config?.availableEditors.includes("file-manager");
  const copy = useCopyToClipboard({
    target: "Fabrication checklist",
    onError: (cause) => setError(cause.message),
  });
  const downloadController = useRef<AbortController | null>(null),
    generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
      downloadController.current?.abort();
    },
    [],
  );
  const packages = asyncValue(listState) ?? [];
  const active =
    selected && packages.some((p) => p.id === selected) ? selected : (packages[0]?.id ?? null);
  const readableActive = packages.find((p) => p.id === active)?.unreadable !== true;
  const detailAtom =
    active && readableActive
      ? pcb.fabPackageZip.resultAtom({ ...target, input: { ...target.input, packageId: active } })
      : idleZip;
  const detailState = useAtomValue(detailAtom),
    refreshDetail = useAtomRefresh(detailAtom),
    refreshList = useAtomRefresh(pcb.fabPackages(target));
  const detail = readableActive
    ? (asyncValue(detailState)?.manifest ?? (finished?.id === active ? finished : null))
    : null;
  const download = async () => {
    if (!detail) return;
    setBusy(true);
    setError(null);
    const serial = generation.current,
      controller = new AbortController();
    downloadController.current = controller;
    try {
      const result = await getZip({ ...target, input: { ...target.input, packageId: detail.id } });
      if (result._tag !== "Success")
        throw new Error("The package download is unavailable. Reload the list.");
      if (controller.signal.aborted) return;
      const response = await fetch(
        modelUrl(threadRef.environmentId, result.value.zip.relativeUrl),
        { signal: controller.signal },
      );
      if (!response.ok) throw new Error("The package zip could not be downloaded.");
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = detail.outputs.find((o) => o.kind === "zip")?.path ?? "gerbers.zip";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      if (!controller.signal.aborted && serial === generation.current)
        setError(cause instanceof Error ? cause.message : "Download failed.");
    } finally {
      if (serial === generation.current) setBusy(false);
    }
  };
  const deletePackage = async () => {
    if (!active || !window.confirm(`Delete ${active} and all its outputs?`)) return;
    setBusy(true);
    const result = await remove({ ...target, input: { ...target.input, packageId: active } });
    if (result._tag === "Failure") setError("The package could not be deleted.");
    else {
      setSelected(null);
      setFinished(null);
    }
    setBusy(false);
  };
  const reveal = async () => {
    if (!detail || !showOpen || !canOpen) return;
    const source = design.absolutePath.slice(0, design.absolutePath.length - design.id.length);
    const result = await open({
      environmentId: threadRef.environmentId,
      input: { cwd: source + detail.workspacePath, editor: "file-manager" },
    });
    if (result._tag === "Failure") setError("The package folder could not be opened.");
  };
  const allFabs = [...(catalog?.builtIns ?? []), ...(catalog?.entries ?? [])];
  const fabId =
    design.kind !== "kicad"
      ? ""
      : selectedFab === ""
        ? ""
        : selectedFab && allFabs.some((f) => f.id === selectedFab)
          ? selectedFab
          : (catalog?.defaultId ?? "");
  const available = design.kind === "kicad" ? !!design.boardPath : executionAllowed;
  return (
    <Scroll>
      <Group title="Create fabrication package">
        <label>
          Profile{" "}
          <select
            aria-label="Fabrication profile"
            value={profile}
            disabled={job !== null}
            onChange={(e) => setProfile(e.target.value === "jlcpcb" ? "jlcpcb" : "generic")}
          >
            <option value="generic">Generic</option>
            <option value="jlcpcb">JLCPCB</option>
          </select>
        </label>
        <label>
          Fab capability check{" "}
          <select
            aria-label="Package fab"
            value={fabId}
            disabled={job !== null || design.kind !== "kicad"}
            onChange={(e) => setFabId(e.target.value)}
          >
            <option value="">None</option>
            {[...(catalog?.builtIns ?? []), ...(catalog?.entries ?? [])].map((f) => (
              <option value={f.id} key={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={assembly}
            disabled={job !== null}
            onChange={(e) => setAssembly(e.target.checked)}
          />{" "}
          Include assembly files
        </label>
        <label>
          <input
            type="checkbox"
            checked={force}
            disabled={job !== null}
            onChange={(e) => setForce(e.target.checked)}
          />{" "}
          Rebuild identical inputs
        </label>
        {job ? (
          <OperationStatus label="Creating fabrication package" onCancel={() => setJob(null)} />
        ) : (
          <Button
            disabled={!allowed || !available || busy}
            onClick={() => {
              setError(null);
              setRevision((n) => n + 1);
              setJob({
                threadId: threadRef.threadId,
                designId: design.id,
                profile,
                assembly,
                force,
                ...(fabId ? { fabId } : {}),
                revision: revision + 1,
              });
            }}
          >
            Create package
          </Button>
        )}
        {!allowed && <Notice>Terminal permission is required to create packages.</Notice>}
        {!available && (
          <Notice>
            {design.kind === "tscircuit"
              ? "Allow circuit code rendering before creating a package."
              : "A fabrication package needs a board."}
          </Notice>
        )}
        <p>
          Packages are saved under fab/. To ignore generated folders in Git, add /fab/*/ to your
          .gitignore.
        </p>
        <p>
          Rotation corrections use part fields and fab/rotations.csv. Verify placements and polarity
          in your fab's preview.
        </p>
      </Group>
      {(error || asyncError(listState) || asyncError(detailState)) && (
        <Notice tone="error">{error ?? asyncError(listState) ?? asyncError(detailState)}</Notice>
      )}
      <Group title="Packages">
        <Button
          size="sm"
          variant="outline"
          disabled={job !== null || busy}
          onClick={() => {
            setError(null);
            refreshList();
            refreshDetail();
          }}
        >
          Reload
        </Button>
        {active && detailState.waiting && !detail && <p>Loading package…</p>}
        {listState.waiting && <p>Loading packages…</p>}
        {!packages.length && !listState.waiting && <p>No packages yet.</p>}
        {packages.map((p) => (
          <Button
            key={p.id}
            variant="outline"
            size="sm"
            aria-pressed={active === p.id}
            onClick={() => {
              setSelected(p.id);
              setError(null);
            }}
          >
            {p.id} · {p.unreadable ? "Unreadable package" : verdictLabel[p.verdict]}
            {isPackageStale(p, sourceHash) ? " · Out of date" : ""}
          </Button>
        ))}
      </Group>
      {active && (
        <Button
          size="sm"
          variant="outline"
          disabled={!canDelete || busy || job !== null}
          onClick={() => void deletePackage()}
        >
          Delete selected package
        </Button>
      )}
      {detail && detail.id === active && (
        <>
          <Group title={verdictLabel[detail.verdict]}>
            <p>
              {detail.profile} · {new Date(detail.createdAt).toLocaleString()}
            </p>
            {isPackageStale(detail, sourceHash) && (
              <Notice tone="warning">This package uses an older design revision.</Notice>
            )}
            {detail.checklist.map((item) => (
              <div key={item.id}>
                <strong>
                  {statusLabel[item.status]}: {item.title}
                </strong>
                <p>{item.detail}</p>
              </div>
            ))}
            {detail.warnings.map((w) => (
              <Notice key={w} tone="warning">
                {w}
              </Notice>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  onPreview({
                    id: detail.id,
                    sourceHash: detail.sourceHash,
                    layers: detail.previewLayers,
                  })
                }
              >
                Preview outputs
              </Button>
              <Button size="sm" disabled={busy} onClick={() => void download()}>
                Download Gerber zip
              </Button>
              {showOpen && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canOpen}
                  onClick={() => void reveal()}
                >
                  Show in folder
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => void copy.copyToClipboard(checklistText(detail), undefined)}
              >
                Copy checklist
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!canDelete || busy || job !== null}
                onClick={() => void deletePackage()}
              >
                Delete
              </Button>
            </div>
          </Group>
          {groupOutputs(detail.outputs).map((group) => (
            <Group title={group.name} key={group.name}>
              {group.files.map((file) => (
                <p key={file.path}>
                  {file.path} · {(file.bytes / 1024).toFixed(1)} KiB
                </p>
              ))}
            </Group>
          ))}
        </>
      )}
    </Scroll>
  );
}
