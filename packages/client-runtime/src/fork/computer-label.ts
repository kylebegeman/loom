import type {
  RelayClientEnvironmentRecord,
  RelayEnvironmentStatusResponse,
} from "@t3tools/contracts/relay";
import { COMPUTER_NAMING_FEATURE } from "@t3tools/contracts/fork";
import type { EnvironmentPresentation } from "../connection/presentation.ts";
import { supportsLoomFeature } from "./capabilities.ts";

/** Older hosts retain this client's local alias; capable hosts own their computer name. */
export function computerDisplayLabel(
  presentation: Pick<EnvironmentPresentation, "entry" | "serverConfig">,
): string {
  const descriptor = presentation.serverConfig?.environment;
  return supportsLoomFeature(descriptor?.capabilities, COMPUTER_NAMING_FEATURE)
    ? (descriptor?.label ?? presentation.entry.target.label)
    : presentation.entry.target.label;
}

/** Discovery already verifies health; reuse it instead of a second fleet registry. */
export function relayComputerDisplayRecord(
  environment: RelayClientEnvironmentRecord,
  status: RelayEnvironmentStatusResponse | null | undefined,
): RelayClientEnvironmentRecord {
  const descriptor = status?.descriptor;
  if (
    status?.status !== "online" ||
    descriptor?.environmentId !== environment.environmentId ||
    !supportsLoomFeature(descriptor.capabilities, COMPUTER_NAMING_FEATURE) ||
    descriptor.label === environment.label
  )
    return environment;
  return { ...environment, label: descriptor.label };
}
