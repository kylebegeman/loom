import { StackActions, useNavigation } from "@react-navigation/native";
import { libraryHoldsLocalRefs } from "@t3tools/client-runtime/fork";
import type { LibraryProject } from "@t3tools/contracts/fork";
import { useEffect } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { NavigationRow } from "../../components/ui/NavigationRow";
import { useEnvironmentQuery } from "../../state/query";
import { useThreadSelection } from "../../state/use-thread-selection";
import { library, useLibraryAuthority } from "./libraryState";

/**
 * Library additions to the new task project picker. A plain "new task" from a thread bound to a
 * Library project reopens that project's start flow, Library projects matching the search are
 * offered first, and local folders a Library project already holds leave the legacy list.
 */
export function useNewTaskLibraryProjects(input: {
  readonly hasRouteParams: boolean;
  readonly searchText: string;
}) {
  const navigation = useNavigation();
  const authority = useLibraryAuthority();
  const { selectedThread } = useThreadSelection();
  const inherit =
    !input.hasRouteParams && authority.environmentId !== null && selectedThread !== null;
  const currentBinding = useEnvironmentQuery(
    inherit && selectedThread
      ? library.threadBinding({
          environmentId: selectedThread.environmentId,
          input: { threadId: selectedThread.id },
        })
      : null,
  );
  useEffect(() => {
    if (!inherit || !currentBinding.data) return;
    const binding = currentBinding.data;
    navigation.getParent()?.dispatch(
      StackActions.replace("LibraryStart", {
        projectId: binding.projectId,
        reuseEnvironmentId: binding.environmentId,
        ...(binding.resourceIds.length === 1 ? { initialResourceId: binding.resourceIds[0] } : {}),
      }),
    );
  }, [inherit, currentBinding.data, navigation]);

  const sharedProjects = useEnvironmentQuery(
    authority.environmentId
      ? library.projects({
          environmentId: authority.environmentId,
          input: { includeArchived: false },
        })
      : null,
  );
  const sharedCopies = useEnvironmentQuery(
    authority.environmentId
      ? library.copies({ environmentId: authority.environmentId, input: {} })
      : null,
  );
  const query = input.searchText.trim().toLocaleLowerCase();
  const choices = (sharedProjects.data ?? []).filter((project) =>
    project.title.toLocaleLowerCase().includes(query),
  );
  const holdsLocalRefs = (refs: readonly { environmentId: string; projectId: string }[]) =>
    libraryHoldsLocalRefs([], refs, sharedCopies.data ?? []);

  return { choices, error: sharedProjects.error, holdsLocalRefs };
}

/** Library projects offered above the local project list; each opens the Library start flow. */
export function NewTaskLibraryProjectChoices(props: {
  readonly choices: readonly LibraryProject[];
  readonly error: string | null;
}) {
  const navigation = useNavigation();
  return (
    <>
      {props.choices.length > 0 ? (
        <View className="overflow-hidden rounded-2xl bg-grouped-card">
          {props.choices.map((project) => (
            <NavigationRow
              key={project.id}
              title={project.title}
              subtitle={
                project.brief.trim().split("\n")[0] ||
                `${project.resources.filter((resource) => resource.kind !== "link").length} repository components`
              }
              onPress={() =>
                navigation
                  .getParent()
                  ?.dispatch(StackActions.replace("LibraryStart", { projectId: project.id }))
              }
            />
          ))}
        </View>
      ) : null}
      {props.error ? (
        <Text accessibilityLiveRegion="polite" className="text-sm text-danger-foreground">
          {props.error}
        </Text>
      ) : null}
    </>
  );
}
