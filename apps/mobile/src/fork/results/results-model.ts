import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { PREVIEW_LINKS_FEATURE, PREVIEW_PAGES_FEATURE } from "@t3tools/contracts/fork";
import type { EnvironmentId, ExecutionEnvironmentCapabilities } from "@t3tools/contracts";

export const RESULTS_SECTION_LIMIT = 6;

export interface ResultsComputer {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connected: boolean;
  readonly previews: boolean;
  readonly pages: boolean;
}

export interface ResultsComputerSource {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly entry: { readonly enabled: boolean };
  readonly connection: { readonly phase: string };
  readonly serverConfig: {
    readonly environment: { readonly capabilities: ExecutionEnvironmentCapabilities };
  } | null;
}

export function resultsComputers(
  environments: readonly ResultsComputerSource[],
): ResultsComputer[] {
  return environments
    .filter((environment) => environment.entry.enabled)
    .map((environment) => ({
      environmentId: environment.environmentId,
      label: environment.label,
      connected: environment.connection.phase === "connected",
      previews: supportsLoomFeature(
        environment.serverConfig?.environment.capabilities,
        PREVIEW_LINKS_FEATURE,
      ),
      pages: supportsLoomFeature(
        environment.serverConfig?.environment.capabilities,
        PREVIEW_PAGES_FEATURE,
      ),
    }))
    .filter((computer) => computer.previews || computer.pages)
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function missingResultsComputerReason(
  environments: readonly ResultsComputerSource[],
  ready: boolean,
) {
  if (!ready) return "loading";
  const enabled = environments.filter((environment) => environment.entry.enabled);
  if (enabled.length === 0) return "connect";
  const connected = enabled.filter((environment) => environment.connection.phase === "connected");
  if (connected.some((environment) => environment.serverConfig === null)) return "loading";
  return connected.length === 0 ? "reconnect" : "unsupported";
}

export function selectedResultsComputer(
  computers: readonly ResultsComputer[],
  selectedId: EnvironmentId | null,
): ResultsComputer | null {
  return (
    computers.find((computer) => computer.environmentId === selectedId) ??
    computers.find((computer) => computer.connected) ??
    computers[0] ??
    null
  );
}

export function matchingResults<A>(
  entries: readonly A[],
  query: string,
  text: (entry: A) => string,
): readonly A[] {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return words.length
    ? entries.filter((entry) => {
        const label = text(entry).toLocaleLowerCase();
        return words.every((word) => label.includes(word));
      })
    : entries;
}
