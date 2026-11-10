// fork: project-navigation - Project mode retains computer filtering without an invisible thread scope.
import { Pressable, ScrollView } from "react-native";
import { SymbolView } from "../../components/ui/AppSymbol";
import { ListFilterMenu } from "../layout/workspace/ListFilterMenu";
import type { EnvironmentId } from "@t3tools/contracts";
import type {
  HomeListFilterMenuEnvironment,
  HomeListFilterMenuProject,
} from "./home-list-filter-menu";

export function ThreadListFilters(props: {
  readonly environments: ReadonlyArray<HomeListFilterMenuEnvironment>;
  readonly projects: ReadonlyArray<HomeListFilterMenuProject>;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly selectedProjectKey: string | null;
  readonly onEnvironmentChange: (environmentId: EnvironmentId | null) => void;
  readonly onProjectChange: (projectKey: string | null) => void;
  /** List padding the scroller bleeds through so pills start where row content does. */
  readonly gutter: number;
  readonly projectView?: boolean; // fork: project-navigation
}) {
  const selectedEnvironment = props.environments.find(
    (environment) => environment.environmentId === props.selectedEnvironmentId,
  );
  const selectedProject = props.projects.find(
    (project) => project.key === props.selectedProjectKey,
  );
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -props.gutter, overflow: "visible" }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 2, paddingBottom: 10, gap: 8 }}
    >
      <ListFilterMenu
        label={selectedEnvironment?.label ?? "All computers"} // fork: fleet-connections
        // fork: project-navigation
        accessibilityLabel={
          props.projectView ? "Filter projects by computer" : "Filter threads by computer"
        }
        active={selectedEnvironment !== undefined}
        actions={[
          {
            id: "all",
            title: "All computers", // fork: fleet-connections
            state: props.selectedEnvironmentId === null ? "on" : "off",
          },
          ...props.environments.map((environment) => ({
            id: JSON.stringify(environment.environmentId),
            title: environment.label,
            state:
              environment.environmentId === props.selectedEnvironmentId
                ? ("on" as const)
                : ("off" as const),
          })),
        ]}
        onSelect={(id) => {
          if (id === "all") props.onEnvironmentChange(null);
          else {
            const environment = props.environments.find(
              (candidate) => JSON.stringify(candidate.environmentId) === id,
            );
            if (environment) props.onEnvironmentChange(environment.environmentId);
          }
        }}
      />
      {/* fork: project-navigation */}
      {!props.projectView ? (
        <ListFilterMenu
          label={selectedProject?.label ?? "All projects"}
          accessibilityLabel="Filter threads by project"
          active={selectedProject !== undefined}
          actions={[
            {
              id: "all",
              title: "All projects",
              state: props.selectedProjectKey === null ? "on" : "off",
            },
            ...props.projects.map((project) => ({
              id: JSON.stringify(project.key),
              title: project.label,
              state: project.key === props.selectedProjectKey ? ("on" as const) : ("off" as const),
            })),
          ]}
          onSelect={(id) => {
            if (id === "all") props.onProjectChange(null);
            else {
              const project = props.projects.find(
                (candidate) => JSON.stringify(candidate.key) === id,
              );
              if (project) props.onProjectChange(project.key);
            }
          }}
        />
      ) : null}
      {props.selectedEnvironmentId !== null ||
      (!props.projectView && props.selectedProjectKey !== null) ? (
        <Pressable
          accessibilityRole="button"
          // fork: project-navigation
          accessibilityLabel={props.projectView ? "Reset project filters" : "Reset thread filters"}
          className="h-8 w-8 items-center justify-center"
          hitSlop={6} // fork: everyday-workflows
          onPress={() => {
            props.onEnvironmentChange(null);
            if (!props.projectView) props.onProjectChange(null); // fork: project-navigation
          }}
        >
          <SymbolView name="xmark.circle.fill" size={18} tintColorClassName="accent-icon-muted" />
        </Pressable>
      ) : null}
    </ScrollView>
  );
}
