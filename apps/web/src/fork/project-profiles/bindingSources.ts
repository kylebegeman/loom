import type { ComponentType } from "react";
import type { ProjectProfile } from "@t3tools/contracts/fork";
export interface ProfileBindingSource {
  readonly kind: string;
  readonly label: string;
  readonly Component: ComponentType<{
    profile: ProjectProfile;
    onChange: (bindings: ProjectProfile["bindings"]) => void;
  }>;
}
/** Optional feature integrations register their own binding editor. */
export const PROFILE_BINDING_SOURCES: readonly ProfileBindingSource[] = [];
