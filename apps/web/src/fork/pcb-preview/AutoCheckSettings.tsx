import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { PcbDesign } from "@t3tools/contracts/fork";
import { Switch } from "~/components/ui/switch";
import { pcb } from "./state";
import { asyncValue } from "./usePcbPreview";
import { runModelCommand } from "../model-preview-3d/state";
import k from "./inspector.module.css";

export function AutoCheckSettings({
  threadRef,
  design,
}: {
  threadRef: ScopedThreadRef;
  design: PcbDesign;
}) {
  const target = {
    environmentId: threadRef.environmentId,
    input: { threadId: threadRef.threadId },
  };
  const loaded = useAtomValue(pcb.projectSettings(target));
  const allowed = useAtomValue(pcb.updateProjectSettings.permissionAtom(threadRef.environmentId));
  const settings = asyncValue(loaded);
  const [saving, setSaving] = useState(false),
    [error, setError] = useState(false);
  return (
    <div>
      <strong>Check after each save</strong>
      {(["erc", "drc", "review"] as const).map((kind) => (
        <label key={kind} className={k.markerToggle}>
          <Switch
            aria-label={`Automatic ${kind.toUpperCase()}`}
            checked={settings?.autoChecks[kind] ?? false}
            disabled={
              !settings ||
              !allowed ||
              saving ||
              !(kind === "review"
                ? design.kind === "tscircuit" || design.schematicPath
                : design.kind === "kicad" &&
                  (kind === "erc" ? design.schematicPath : design.boardPath))
            }
            onCheckedChange={(enabled) => {
              setSaving(true);
              setError(false);
              void runModelCommand(pcb.updateProjectSettings, {
                ...target,
                input: { ...target.input, autoChecks: { [kind]: enabled } },
              })
                .catch(() => setError(true))
                .finally(() => setSaving(false));
            }}
          />
          {kind.toUpperCase()}
        </label>
      ))}
      <p className={k.hint}>
        For this project. Runs while this design is open or when an agent reads checks.
      </p>
      {(error || loaded._tag === "Failure") && (
        <p role="alert" className={k.error}>
          The setting could not be saved or loaded.
        </p>
      )}
    </div>
  );
}
