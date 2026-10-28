import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import * as Cause from "effect/Cause";
import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  PCB_LAYER_PRESETS,
  resolveLayerPreset,
  defaultPrintLayers,
  type PcbDesign,
  type PcbInspection,
  type PcbPrintInput,
  type PcbPrintPaper,
  type PcbPrintResult,
} from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "~/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "~/components/ui/select";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { serverEnvironment } from "~/state/server";
import { shellEnvironment } from "~/state/shell";
import { useAtomCommand } from "~/state/use-atom-command";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { isElectron } from "~/env";
import { modelUrl } from "../model-preview-3d/state";
import { pcb } from "./state";
import { useLengthUnit } from "./preferences";
import { formatLengths } from "./length";
import { initialPrintOptions, isPrintStale } from "./trueScalePrint.logic";
import { OperationStatus } from "./OperationStatus";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  threadRef: ScopedThreadRef;
  design: PcbDesign;
  inspection: PcbInspection | null;
  currentSourceHash: string | null;
  trusted: boolean;
  canPrint: boolean;
};
const PAPERS: { value: PcbPrintPaper; label: string }[] = [
  { value: "board", label: "Board page" },
  { value: "A4", label: "A4" },
  { value: "USLetter", label: "US Letter" },
  { value: "A3", label: "A3" },
  { value: "USLedger", label: "US Ledger" },
];

/** A result-atom lease carries cancel and dialog-unmount through to the host subprocess. */
function startPrintRequest(threadRef: ScopedThreadRef, input: PcbPrintInput) {
  const atom = pcb.print.resultAtom({ environmentId: threadRef.environmentId, input });
  let done = false,
    unsubscribe: (() => void) | null = null,
    unmount: (() => void) | null = null;
  let rejectRequest!: (cause: unknown) => void;
  const cleanup = () => {
    unsubscribe?.();
    unmount?.();
    unsubscribe = unmount = null;
  };
  const promise = new Promise<PcbPrintResult>((resolve, reject) => {
    rejectRequest = reject;
    appAtomRegistry.refresh(atom);
    unmount = appAtomRegistry.mount(atom);
    const initial = appAtomRegistry.get(atom);
    const inspect = (value: typeof initial) => {
      if (done || value.waiting || value._tag === "Initial") return;
      done = true;
      if (value._tag === "Failure") reject(Cause.squash(value.cause));
      else resolve(value.value);
      cleanup();
    };
    unsubscribe = appAtomRegistry.subscribe(atom, inspect);
    inspect(appAtomRegistry.get(atom));
    if (done) cleanup();
  });
  return {
    promise,
    cancel: () => {
      if (done) return;
      done = true;
      cleanup();
      rejectRequest(new Error("PDF creation was cancelled."));
    },
  };
}

export function TrueScalePrintDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Print at 1:1</DialogTitle>
          <DialogDescription>
            Create a PDF to check real parts against their footprints. Print at 100% and measure the
            50 mm bar with a ruler.
          </DialogDescription>
        </DialogHeader>
        {props.open && <PrintContents {...props} />}
      </DialogPopup>
    </Dialog>
  );
}
function PrintContents({
  threadRef,
  design,
  inspection,
  currentSourceHash,
  trusted,
  canPrint,
  onOpenChange,
}: Props) {
  const boardLayers = [
    ...new Set(
      inspection?.layers.length
        ? [...inspection.layers, "Edge.Cuts"]
        : [...defaultPrintLayers("top"), ...defaultPrintLayers("bottom")],
    ),
  ];
  const [options, setOptions] = useState<Omit<PcbPrintInput, "threadId" | "designId" | "save">>(
    () => initialPrintOptions("top", boardLayers),
  );
  const [result, setResult] = useState<PcbPrintResult | null>(null),
    [running, setRunning] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState<string | null>(null),
    [downloading, setDownloading] = useState(false);
  const generation = useRef(0),
    request = useRef<ReturnType<typeof startPrintRequest> | null>(null),
    fetchController = useRef<AbortController | null>(null);
  const unit = useLengthUnit(),
    primary = usePrimaryEnvironmentId();
  const config = useAtomValue(serverEnvironment.configValueAtom(threadRef.environmentId));
  const canOpen = useAtomValue(
    shellEnvironment.openInEditor.permissionAtom(threadRef.environmentId),
  );
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, { reportFailure: false });
  const localHost = isElectron && primary === threadRef.environmentId;
  const showOpen = localHost && config?.availableEditors.includes("file-manager");
  const showReveal = showOpen && config?.shellRevealInFileManager === true;
  const allowed = canPrint && (design.kind === "kicad" ? !!design.boardPath : trusted);
  const layers = Array.isArray(options.layers) ? options.layers : [];
  const stale = result ? isPrintStale(result, currentSourceHash) : false;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- cancels the in-flight print request and fetch on unmount
  useEffect(
    () => () => {
      generation.current++;
      request.current?.cancel();
      fetchController.current?.abort();
    },
    [],
  );
  const cancel = () => {
    generation.current++;
    request.current?.cancel();
    request.current = null;
    setRunning(false);
  };
  const create = async (save: boolean) => {
    if (!allowed) return;
    cancel();
    const own = generation.current;
    setRunning(true);
    setSaving(save);
    setError(null);
    const lease = startPrintRequest(threadRef, {
      ...options,
      threadId: threadRef.threadId,
      designId: design.id,
      save,
    });
    request.current = lease;
    await lease.promise
      .then((value) => {
        if (generation.current === own) setResult(value);
      })
      .catch((cause: unknown) => {
        if (generation.current === own)
          setError(
            cause instanceof Error ? cause.message : "The PDF could not be created. Try again.",
          );
      })
      .finally(() => {
        if (generation.current === own) {
          setRunning(false);
          request.current = null;
        }
      });
  };
  const download = async () => {
    if (!result) return;
    setDownloading(true);
    setError(null);
    const controller = new AbortController();
    fetchController.current = controller;
    // The async wrapper routes a synchronous throw from `modelUrl` to the catch handler.
    await (async () => {
      const response = await fetch(modelUrl(threadRef.environmentId, result.file.relativeUrl), {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("The PDF download is unavailable. Create the PDF again.");
      const url = URL.createObjectURL(await response.blob()),
        link = document.createElement("a");
      link.href = url;
      link.download = result.fileName;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    })()
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "The PDF could not be downloaded.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setDownloading(false);
        fetchController.current = null;
      });
  };
  const openFile = async (reveal: boolean) => {
    if (!result?.path || !canOpen || !showOpen || (reveal && !showReveal)) return;
    const value = await openInEditor({
      environmentId: threadRef.environmentId,
      input: { cwd: result.path, editor: "file-manager", ...(reveal ? { reveal: true } : {}) },
    });
    if (value._tag === "Failure")
      setError(
        reveal
          ? "The saved PDF could not be shown in its folder."
          : "The saved PDF could not be opened.",
      );
  };
  return (
    <>
      <DialogPanel>
        {running ? (
          <OperationStatus
            label={saving ? "Saving PDF to workspace" : "Creating PDF"}
            detail="The design files stay unchanged."
            onCancel={cancel}
          />
        ) : result ? (
          <div className="flex flex-col gap-3 text-sm">
            <strong>{result.fileName}</strong>
            {result.boardMm && (
              <span>
                Board outline {formatLengths([result.boardMm.width, result.boardMm.height], unit)}
              </span>
            )}
            <span>
              {result.side === "top" ? "Top" : "Bottom"}
              {result.mirrored ? ", mirrored" : ""} ·{" "}
              {PAPERS.find((paper) => paper.value === result.paper)?.label}
            </span>
            {stale && (
              <p role="status">
                This PDF is from an older board revision. Create a new PDF to print the current
                design.
              </p>
            )}
            {result.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
            {result.workspacePath && (
              <p>
                Saved to <code>{result.workspacePath}</code>
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button disabled={downloading} onClick={() => void download()}>
                Download PDF
              </Button>
              {stale && (
                <Button variant="outline" disabled={!allowed} onClick={() => void create(false)}>
                  Create new PDF
                </Button>
              )}
              {!result.workspacePath && (
                <Button
                  variant="outline"
                  disabled={!allowed || stale}
                  onClick={() => void create(true)}
                >
                  Save to workspace
                </Button>
              )}
              {result.path && showOpen && (
                <Button variant="outline" disabled={!canOpen} onClick={() => void openFile(false)}>
                  Open
                </Button>
              )}
              {result.path && showReveal && (
                <Button variant="outline" disabled={!canOpen} onClick={() => void openFile(true)}>
                  Show in folder
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 text-sm">
            {inspection?.bounds && (
              <p>
                Board outline{" "}
                {formatLengths([inspection.bounds.width, inspection.bounds.height], unit)}
              </p>
            )}
            <fieldset>
              <legend className="mb-2">Side</legend>
              <div className="flex gap-2">
                {(["top", "bottom"] as const).map((side) => (
                  <Button
                    key={side}
                    variant={options.side === side ? "default" : "outline"}
                    aria-pressed={options.side === side}
                    onClick={() =>
                      setOptions({
                        ...options,
                        ...initialPrintOptions(side, boardLayers),
                        paper: options.paper,
                        blackAndWhite: options.blackAndWhite,
                      })
                    }
                  >
                    {side === "top" ? "Top" : "Bottom"}
                  </Button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-2">Layers</legend>
              <div className="mb-2 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() =>
                    setOptions({
                      ...options,
                      layers: initialPrintOptions(options.side, boardLayers).layers,
                    })
                  }
                >
                  Reset to defaults
                </Button>
                {PCB_LAYER_PRESETS.map((preset) => {
                  const resolved = resolveLayerPreset(preset, boardLayers);
                  return (
                    <Button
                      key={preset.id}
                      variant="outline"
                      size="xs"
                      disabled={!resolved}
                      onClick={() =>
                        resolved &&
                        setOptions({
                          ...options,
                          layers: resolved
                            .filter((layer) => layer.visible)
                            .map((layer) => layer.name),
                        })
                      }
                    >
                      {preset.name}
                    </Button>
                  );
                })}
              </div>
              <div className="grid max-h-44 grid-cols-2 gap-2 overflow-auto">
                {boardLayers.map((name) => (
                  <label key={name} className="flex items-center gap-2">
                    <Checkbox
                      checked={layers.includes(name)}
                      onCheckedChange={(checked) =>
                        setOptions({
                          ...options,
                          layers: checked
                            ? [...layers, name]
                            : layers.filter((layer) => layer !== name),
                        })
                      }
                    />
                    {inspection?.layerLabels?.[name]
                      ? `${inspection.layerLabels[name]} (${name})`
                      : name}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={options.mirror ?? false}
                onCheckedChange={(mirror) => setOptions({ ...options, mirror })}
              />
              Mirror
            </label>
            <label className="flex flex-col gap-2">
              Paper
              <Select
                value={options.paper}
                onValueChange={(paper) => paper && setOptions({ ...options, paper })}
              >
                <SelectTrigger>
                  <SelectValue>
                    {PAPERS.find((paper) => paper.value === options.paper)?.label}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {PAPERS.map((paper) => (
                    <SelectItem key={paper.value} value={paper.value}>
                      {paper.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </label>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={options.blackAndWhite}
                onCheckedChange={(blackAndWhite) => setOptions({ ...options, blackAndWhite })}
              />
              Black and white
            </label>
            <p className="text-muted-foreground">Nothing is written to your design files.</p>
            {!allowed && (
              <p>
                {!canPrint
                  ? "This connection cannot run PCB tools."
                  : "Trust this project's circuit code before printing."}
              </p>
            )}
          </div>
        )}
        {error && (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </DialogPanel>
      <DialogFooter>
        <Button
          variant="outline"
          onClick={() => {
            cancel();
            onOpenChange(false);
          }}
        >
          Close
        </Button>
        {result ? (
          <Button
            variant="outline"
            disabled={running}
            onClick={() => {
              setResult(null);
              setError(null);
            }}
          >
            Change options
          </Button>
        ) : (
          <Button
            disabled={!allowed || !layers.length || running}
            onClick={() => void create(false)}
          >
            Create PDF
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
