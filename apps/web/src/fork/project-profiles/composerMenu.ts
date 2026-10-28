import { useEffect } from "react";
import type { ComposerTrigger } from "~/composer-logic";
import type { ForkComposerCommandItem } from "../composer/menu";
import type { ForkComposerContext, ForkPromptReplace } from "../composer/registry";
import { useEnvironmentQuery } from "~/state/query";
import { profiles, requestProfileAction, useProfilesSupported } from "./state";
import { projectNotesSupported, setProjectNotesSupported } from "./composerBridgeStore";
const notesItemId = (context: Pick<ForkComposerContext, "environmentId" | "projectId">) =>
  `project-profiles:notes:${JSON.stringify([context.environmentId, context.projectId])}`;
export function projectNotesItem(
  context: Pick<ForkComposerContext, "environmentId" | "projectId">,
  notes: string | null,
  loading: boolean,
  failed = false,
): ForkComposerCommandItem {
  return {
    id: notesItemId(context),
    type: "loom",
    source: "project-profiles",
    label: loading
      ? "Loading project notes..."
      : failed
        ? "Could not load project notes"
        : notes?.trim()
          ? "Insert project notes"
          : "Add project notes",
    description:
      loading || failed
        ? "Project profile"
        : notes?.trim()
          ? notes.split("\n")[0]!
          : "Write private notes for this project",
    value: notes ?? "",
    disabled: loading || failed,
  };
}
export function useProjectNotesMenuItems(
  context: ForkComposerContext,
  trigger: ComposerTrigger | null,
): readonly ForkComposerCommandItem[] {
  const supported = useProfilesSupported(context.environmentId) && context.projectId !== null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes project notes support to the composer bridge module store and resets it on unmount
  useEffect(() => {
    setProjectNotesSupported(supported);
    return () => setProjectNotesSupported(false);
  }, [supported]);
  const active = trigger?.kind === "loom:project-notes";
  const query = useEnvironmentQuery(
    active && supported && context.projectId
      ? profiles.profile({
          environmentId: context.environmentId,
          input: { projectId: context.projectId },
        })
      : null,
  );
  if (!active || !supported || (trigger.query && !"notes".startsWith(trigger.query))) return [];
  return [
    projectNotesItem(
      context,
      query.data?.agentNotes ?? null,
      query.data === null && query.error === null,
      query.error !== null,
    ),
  ];
}
export function selectProjectNotes(
  item: ForkComposerCommandItem,
  options: {
    snapshot: { value: string };
    trigger: ComposerTrigger;
    replace: ForkPromptReplace;
    context: ForkComposerContext;
  },
): boolean {
  if (
    item.disabled ||
    !projectNotesSupported() ||
    options.context.projectId === null ||
    item.id !== notesItemId(options.context)
  )
    return false;
  const { trigger, snapshot, context } = options;
  const replacement = item.value.trim() ? `Project notes:\n${item.value}\n` : "";
  const applied = options.replace(trigger.rangeStart, trigger.rangeEnd, replacement, {
    expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
    focusEditorAfterReplace: replacement !== "",
  });
  if (applied && !replacement)
    requestProfileAction({
      kind: "edit",
      environmentId: context.environmentId,
      projectId: context.projectId!,
    });
  return applied;
}
