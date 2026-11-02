import type { ScopedThreadRef } from "@t3tools/contracts";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { Button } from "~/components/ui/button";
import { useServerConfigs } from "~/state/entities";
import { openDevEnvironment } from "./state";
export function DevEnvironmentShortcut({ threadRef }: { threadRef: ScopedThreadRef }) {
  const config = useServerConfigs().get(threadRef.environmentId);
  if (!supportsLoomFeature(config?.environment.capabilities, "browser-dev-tools")) return null;
  return (
    <Button variant="outline" size="sm" onClick={() => openDevEnvironment(threadRef)}>
      Run and manage this checkout
    </Button>
  );
}
