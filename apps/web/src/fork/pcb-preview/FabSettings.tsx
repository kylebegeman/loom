import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { SettingsRow } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { LoomSettingsActions, LoomSettingsNotice } from "~/fork/settings/parts";
import { pcb } from "./state";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { asyncError, asyncValue } from "./usePcbPreview";
import { useWrite } from "./InspectorKit";
import { runModelCommand } from "../model-preview-3d/state";
import { FabCapabilitiesDialog } from "./FabCapabilitiesDialog";

export function FabSettings({ environmentId }: { environmentId: EnvironmentId }) {
  const result = useAtomValue(pcb.fabCapabilities({ environmentId, input: {} }));
  const catalog = asyncValue(result);
  const allowed = useAtomValue(pcb.updateFabCapabilities.permissionAtom(environmentId));
  const [open, setOpen] = useState(false);
  const write = useWrite();
  const profiles = [...(catalog?.builtIns ?? []), ...(catalog?.entries ?? [])];
  const error = asyncError(result) ?? write.error;
  return (
    <>
      <SettingsRow
        title="Fabrication profile"
        description="Choose the default fabrication limits for this environment."
        control={
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1 basis-40">
              <Select
                value={catalog?.defaultId ?? ""}
                disabled={!allowed || !catalog || write.busy}
                onValueChange={(value) => {
                  if (!catalog || value === null) return;
                  void write.run(() =>
                    runModelCommand(pcb.updateFabCapabilities, {
                      environmentId,
                      input: {
                        expectedVersion: catalog.version,
                        entries: catalog.entries,
                        defaultId: value,
                      },
                    }),
                  );
                }}
              >
                <SelectTrigger size="sm" aria-label="Default fabrication profile">
                  <SelectValue>
                    {profiles.find((profile) => profile.id === catalog?.defaultId)?.name ??
                      (result.waiting ? "Loading profiles…" : "Choose a profile")}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {profiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
              Manage profiles
            </Button>
          </div>
        }
      />
      {write.busy && (
        <LoomSettingsNotice role="status">Saving fabrication profile...</LoomSettingsNotice>
      )}
      {error && (
        <>
          <LoomSettingsNotice role="alert">{error}</LoomSettingsNotice>
          <LoomSettingsActions>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                appAtomRegistry.refresh(pcb.fabCapabilities({ environmentId, input: {} }))
              }
            >
              Reload profiles
            </Button>
          </LoomSettingsActions>
        </>
      )}
      <FabCapabilitiesDialog environmentId={environmentId} open={open} onOpenChange={setOpen} />
    </>
  );
}
