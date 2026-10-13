import type { StaticScreenProps } from "@react-navigation/native";
import { AddProjectSourceScreen } from "./AddProjectScreen";
import type { EnvironmentId } from "@t3tools/contracts";

// fork: fleet-connections - Keep Add project on the computer selected in Connections.
export function AddProjectSourceRoute({
  route,
}: StaticScreenProps<{ readonly environmentId?: EnvironmentId } | undefined>) {
  return <AddProjectSourceScreen initialEnvironmentId={route.params?.environmentId} />;
}
