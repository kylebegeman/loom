import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { SettingsRow } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { pcb } from "./state";
import { asyncValue } from "./usePcbPreview";
import { useWrite } from "./InspectorKit";
import { runModelCommand } from "../model-preview-3d/state";
import { FabCapabilitiesDialog } from "./FabCapabilitiesDialog";
export function FabSettings({ environmentId }: { environmentId: EnvironmentId }) {
  const catalog = asyncValue(useAtomValue(pcb.fabCapabilities({ environmentId, input: {} }))),
    allowed = useAtomValue(pcb.updateFabCapabilities.permissionAtom(environmentId));
  const [open, setOpen] = useState(false),
    write = useWrite();
  return (
    <>
      <SettingsRow
        title="Fab"
        description="Choose the default fabrication profile for this environment."
        control={
          <div className="flex gap-2">
            <select
              aria-label="Default fab"
              value={catalog?.defaultId ?? ""}
              disabled={!allowed || !catalog || write.busy}
              onChange={(e) =>
                void write.run(async () => {
                  if (catalog)
                    await runModelCommand(pcb.updateFabCapabilities, {
                      environmentId,
                      input: {
                        expectedVersion: catalog.version,
                        entries: catalog.entries,
                        defaultId: e.target.value,
                      },
                    });
                })
              }
            >
              {[...(catalog?.builtIns ?? []), ...(catalog?.entries ?? [])].map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
              Manage…
            </Button>
          </div>
        }
      />
      {write.error && <p role="alert">{write.error}</p>}
      <FabCapabilitiesDialog environmentId={environmentId} open={open} onOpenChange={setOpen} />
    </>
  );
}
