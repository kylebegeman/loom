import type { EnvironmentId } from "@t3tools/contracts";
import { Atom, type AtomRegistry } from "effect/reactivity";
import { bots } from "../bots/state";
import { library } from "../library/libraryState";
import { previewLinks } from "../preview-links/state";
import { sites } from "../sites/state";

export interface GlobalSearchSourceTargets {
  readonly library: EnvironmentId | null;
  readonly sites: EnvironmentId | null;
  readonly computers: readonly {
    readonly environmentId: EnvironmentId;
    readonly previews: boolean;
    readonly bots: boolean;
  }[];
}

export const EMPTY_SEARCH_SOURCES: GlobalSearchSourceTargets = {
  library: null,
  sites: null,
  computers: [],
};

export const globalSearchSources = Atom.family((key: string) => {
  const targets = JSON.parse(key) as GlobalSearchSourceTargets;
  return Atom.make((get) => ({
    projects: targets.library
      ? get(library.projects({ environmentId: targets.library, input: { includeArchived: false } }))
      : null,
    sites: targets.sites ? get(sites.snapshot({ environmentId: targets.sites, input: {} })) : null,
    computers: targets.computers.map((computer) => ({
      environmentId: computer.environmentId,
      canOpenPreviews:
        computer.previews && get(previewLinks.open.permissionAtom(computer.environmentId)),
      previews: computer.previews
        ? get(previewLinks.snapshot({ environmentId: computer.environmentId, input: {} }))
        : null,
      bots: computer.bots
        ? get(bots.list({ environmentId: computer.environmentId, input: {} }))
        : null,
    })),
  }));
});

export function refreshGlobalSearchSources(
  registry: AtomRegistry.AtomRegistry,
  targets: GlobalSearchSourceTargets,
) {
  if (targets.library)
    registry.refresh(
      library.projects({ environmentId: targets.library, input: { includeArchived: false } }),
    );
  if (targets.sites) registry.refresh(sites.snapshot({ environmentId: targets.sites, input: {} }));
  for (const computer of targets.computers) {
    if (computer.previews)
      registry.refresh(previewLinks.snapshot({ environmentId: computer.environmentId, input: {} }));
    if (computer.bots)
      registry.refresh(bots.list({ environmentId: computer.environmentId, input: {} }));
  }
}
