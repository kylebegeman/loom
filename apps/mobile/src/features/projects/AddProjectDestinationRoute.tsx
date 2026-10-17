// fork: project-home - Reviewed preparation keeps its stable clone request through the existing destination flow.
import type { StaticScreenProps } from "@react-navigation/native";
import { AddProjectDestinationScreen } from "./AddProjectScreen";

type AddProjectDestinationRouteParams = {
  readonly environmentId?: string | string[];
  readonly source?: string | string[];
  readonly remoteUrl?: string | string[];
  readonly repositoryTitle?: string | string[];
  readonly repositoryName?: string | string[];
  // fork: project-home
  readonly preparationSourceEnvironmentId?: string | string[];
  readonly preparationSourceProjectId?: string | string[];
  readonly preparationProjectId?: string | string[];
  readonly preparationCreatedAt?: string | string[];
  readonly preparationRepositoryKey?: string | string[];
  readonly preparationDestinationPath?: string | string[];
  readonly prompt?: string | string[];
};

export function AddProjectDestinationRoute({
  route,
}: StaticScreenProps<AddProjectDestinationRouteParams | undefined>) {
  return <AddProjectDestinationScreen {...(route.params ?? {})} />;
}
