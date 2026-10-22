import { useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  BUILT_IN_PRINTERS,
  PrinterExport,
  USER_PRINTER_LIMIT,
  libraryProblems,
  type Printer,
  type PrinterLibrary,
} from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { randomUUID } from "~/lib/utils";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { saveImage } from "./captureExport";
import { models, runModelCommand } from "./state";
import { blankPrinter, mergePrinterExport } from "./printers";
import { PrinterEditor } from "./PrinterEditor";
import { MaterialsSection } from "./MaterialsSection";
import { formatLengths, useDisplayUnits } from "./units";
import {
  LoomSettingsActions,
  LoomSettingsContent,
  LoomSettingsDetails,
  LoomSettingsNotice,
} from "../settings/parts";

const decodePrinterExport = Schema.decodeUnknownSync(Schema.fromJsonString(PrinterExport));

function validateLibrary(value: PrinterLibrary) {
  const problems = libraryProblems(value);
  if (problems.length) throw new Error(problems[0]);
}

export function PrintersSection({ environmentId }: { environmentId: EnvironmentId }) {
  const result = useAtomValue(models.printers({ environmentId, input: {} }));
  const canSave = useAtomValue(models.updatePrinters.permissionAtom(environmentId));
  const fetched = Option.getOrNull(AsyncResult.value(result));
  const [saved, setSaved] = useState<PrinterLibrary | null>(null),
    [editing, setEditing] = useState<Printer | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [warnings, setWarnings] = useState<readonly string[]>([]);
  const profileInput = useRef<HTMLInputElement>(null),
    libraryInput = useRef<HTMLInputElement>(null);
  const units = useDisplayUnits();
  const library = fetched && (!saved || fetched.version > saved.version) ? fetched : saved;
  const refresh = () => {
    appAtomRegistry.refresh(models.printers({ environmentId, input: {} }));
    appAtomRegistry.refresh(models.settings({ environmentId, input: {} }));
  };
  if (!library)
    return (
      <LoomSettingsContent className="flex flex-col gap-3">
        {result._tag === "Failure" ? (
          <>
            <LoomSettingsNotice role="alert">
              Could not load printers. {String(Cause.squash(result.cause))}
            </LoomSettingsNotice>
            <LoomSettingsActions>
              <Button size="sm" variant="outline" onClick={refresh}>
                Retry
              </Button>
            </LoomSettingsActions>
          </>
        ) : (
          <LoomSettingsNotice role="status">Loading printers...</LoomSettingsNotice>
        )}
      </LoomSettingsContent>
    );
  const libraryVersion = library.version;
  const save = async (value: PrinterLibrary, expectedVersion = libraryVersion): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      validateLibrary(value);
      const next = await runModelCommand(models.updatePrinters, {
        environmentId,
        input: {
          expectedVersion,
          printers: value.printers,
          materials: value.materials,
          hiddenBuiltIns: value.hiddenBuiltIns,
        },
      });
      setSaved(next);
      refresh();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The library could not be saved.";
      setError(message);
      setBusy(false);
      throw cause;
    }
    setBusy(false);
  };
  const action = (operation: Promise<void>) => {
    void operation.catch(() => undefined);
  };
  const remove = async (printer: Printer) => {
    const before = library;
    await save({ ...library, printers: library.printers.filter((p) => p.id !== printer.id) });
    toastManager.add({
      title: `Deleted ${printer.name}.`,
      timeout: 10000,
      actionProps: { children: "Undo", onClick: () => action(save(before, before.version + 1)) },
    });
  };
  const duplicate = (id: keyof typeof BUILT_IN_PRINTERS) => {
    const entry = BUILT_IN_PRINTERS[id];
    setEditing({
      ...blankPrinter(`custom-${randomUUID()}`, entry.kind),
      name: `${entry.label} copy`.slice(0, 60),
      volumeMm: entry.volumeMm,
      bedShape: entry.bedShape,
      nozzlesMm: entry.nozzlesMm,
      zones: entry.zones,
      excludedAreasMm: entry.excludedAreasMm,
      notes: entry.note ?? "",
      basedOn: id,
    });
  };
  const importFile = async (file: File, profile: boolean) => {
    if (file.size > 2 * 1024 * 1024) {
      setError("Files must be at most 2 MiB.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const text = await file.text();
      if (profile) {
        const draft = await runModelCommand(models.parsePrinterProfile, {
          environmentId,
          input: { fileName: file.name, text },
        });
        setWarnings(draft.warnings);
        setEditing(draft.printer);
      } else {
        const imported = decodePrinterExport(text);
        const merged = mergePrinterExport(library, imported);
        await save(merged.value);
        toastManager.add({
          title: `Imported ${merged.printers} printers and ${merged.materials} materials. ${merged.kept} already existed and were kept.`,
        });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The file could not be imported.");
    }
    setBusy(false);
  };
  const atLimit = library.printers.length >= USER_PRINTER_LIMIT;
  return (
    <div className="min-w-0" id="printers">
      <div className="flex min-w-0 flex-col gap-5">
        <fieldset disabled={!canSave || busy} className="flex min-w-0 flex-col gap-4">
          <legend className="mb-3 text-sm font-semibold">Printer and material library</legend>
          <LoomSettingsNotice>
            Printers and materials belong to this environment. Export the library to keep a portable
            backup. Library changes save immediately, separately from model settings.
          </LoomSettingsNotice>
          <div className="flex min-w-0 flex-col gap-4">
            <h4 className="text-sm font-semibold">Your printers</h4>
            {!library.printers.length && (
              <LoomSettingsNotice>
                No printers of your own yet. Add one or import a profile.
              </LoomSettingsNotice>
            )}
            {library.printers.map((printer) => (
              <div
                key={printer.id}
                className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-border/60 py-4"
              >
                <div className="min-w-0 flex-1 basis-48 text-xs wrap-anywhere">
                  <p className="text-sm font-medium">{printer.name}</p>
                  <p className="text-muted-foreground">
                    {formatLengths(printer.volumeMm, units, { trim: true })}
                    {printer.bedShape === "round" ? " · Round" : ""}
                    {printer.nozzlesMm.length ? ` · ${printer.nozzlesMm.join(", ")} mm nozzle` : ""}
                  </p>
                  {printer.source.kind === "imported" && (
                    <p className="text-muted-foreground">Imported from {printer.source.app}</p>
                  )}
                </div>
                <LoomSettingsActions>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      setWarnings([]);
                      setEditing(printer);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={atLimit}
                    onClick={() =>
                      setEditing({
                        ...printer,
                        id: `custom-${randomUUID()}`,
                        name: `${printer.name} copy`.slice(0, 60),
                      })
                    }
                  >
                    Duplicate
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => action(remove(printer))}>
                    Delete
                  </Button>
                </LoomSettingsActions>
              </div>
            ))}
            <LoomSettingsActions>
              <Button
                size="sm"
                variant="outline"
                disabled={atLimit}
                onClick={() => setEditing(blankPrinter(`custom-${randomUUID()}`, "printer"))}
              >
                Add printer
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={atLimit}
                onClick={() => setEditing(blankPrinter(`custom-${randomUUID()}`, "surface"))}
              >
                Add surface
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={atLimit}
                onClick={() => profileInput.current?.click()}
              >
                Import printer profile
              </Button>
            </LoomSettingsActions>
            {atLimit && <LoomSettingsNotice>Up to 64 printers and surfaces.</LoomSettingsNotice>}
          </div>
          <LoomSettingsDetails title="Built-in printers and surfaces">
            {(["printer", "surface"] as const).map((kind) => (
              <div key={kind} className="flex min-w-0 flex-col gap-3">
                <h4 className="text-xs font-medium">
                  {kind === "printer" ? "Built-in printers" : "Surfaces"}
                </h4>
                {Object.entries(BUILT_IN_PRINTERS)
                  .filter(([, p]) => p.kind === kind)
                  .map(([id, entry]) => {
                    const preset = id as keyof typeof BUILT_IN_PRINTERS;
                    const hidden = library.hiddenBuiltIns.includes(preset);
                    return (
                      <div
                        key={id}
                        className={`flex min-w-0 flex-wrap items-center justify-between gap-3 text-xs ${hidden ? "opacity-60" : ""}`}
                      >
                        <div className="min-w-0 flex-1 basis-48 wrap-anywhere">
                          {entry.label}
                          <p className="text-muted-foreground">
                            {formatLengths(entry.volumeMm, units, { trim: true })} · Built in
                            {hidden ? " · Hidden" : ""}
                          </p>
                        </div>
                        <LoomSettingsActions>
                          <Button
                            size="xs"
                            variant="ghost"
                            disabled={atLimit}
                            onClick={() => duplicate(preset)}
                          >
                            Duplicate
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() =>
                              action(
                                save({
                                  ...library,
                                  hiddenBuiltIns: hidden
                                    ? library.hiddenBuiltIns.filter((value) => value !== preset)
                                    : [...library.hiddenBuiltIns, preset],
                                }),
                              )
                            }
                          >
                            {hidden ? "Show" : "Hide"}
                          </Button>
                        </LoomSettingsActions>
                      </div>
                    );
                  })}
              </div>
            ))}
          </LoomSettingsDetails>
          <MaterialsSection library={library} disabled={!canSave || busy} save={save} />
          <LoomSettingsActions>
            <Button size="sm" variant="outline" onClick={() => libraryInput.current?.click()}>
              Import library
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const value = {
                  format: "loom.printers",
                  version: 1,
                  exportedAt: new Date().toISOString(),
                  printers: library.printers,
                  materials: library.materials,
                };
                saveImage(
                  new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
                  "loom-printers.json",
                );
              }}
            >
              Export library
            </Button>
          </LoomSettingsActions>
          <input
            hidden
            type="file"
            accept=".json,.ini"
            ref={profileInput}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void importFile(file, true);
            }}
          />
          <input
            hidden
            type="file"
            accept=".json"
            ref={libraryInput}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void importFile(file, false);
            }}
          />
        </fieldset>
        {error && (
          <div className="flex min-w-0 flex-col gap-3">
            <LoomSettingsNotice role="alert">{error}</LoomSettingsNotice>
            <LoomSettingsActions>
              <Button
                size="sm"
                variant="link"
                onClick={() => {
                  setSaved(null);
                  refresh();
                }}
              >
                Reload
              </Button>
            </LoomSettingsActions>
          </div>
        )}
        {editing && (
          <>
            {warnings.length > 0 && (
              <LoomSettingsNotice>
                <ul className="list-disc space-y-1 pl-4">
                  {warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </LoomSettingsNotice>
            )}
            <PrinterEditor
              key={editing.id}
              initial={editing}
              library={library}
              busy={busy}
              onClose={() => setEditing(null)}
              onSave={(printer) =>
                save({
                  ...library,
                  printers: [...library.printers.filter((p) => p.id !== printer.id), printer],
                })
              }
            />
          </>
        )}
      </div>
    </div>
  );
}
