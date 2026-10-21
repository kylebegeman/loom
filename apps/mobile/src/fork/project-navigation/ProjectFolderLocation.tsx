import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import {
  createProjectCheckoutAtoms,
  libraryProjectForLocalRefs,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationReadScope, type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import { useContext, useRef, useState } from "react";
import { View } from "react-native";

import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { Sheet } from "../../components/ui/Sheet";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentServerConfig } from "../../state/entities";
import { environmentPresentations, useEnvironmentPresentation } from "../../state/presentation";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { library, useLibraryAuthority } from "../library/libraryState";

const checkouts = createProjectCheckoutAtoms(connectionAtomRuntime);
type FolderTarget = {
  readonly environmentId: EnvironmentId;
  readonly id: ProjectId;
  readonly workspaceRoot: string;
  readonly isScratch?: boolean;
};

export function ProjectFolderLocation({
  project,
  computerLabel,
  disabled = false,
}: {
  readonly project: FolderTarget;
  readonly computerLabel: string;
  readonly disabled?: boolean;
}) {
  const { presentation } = useEnvironmentPresentation(project.environmentId);
  const canUpdate = useAtomValue(projectEnvironment.update.permissionAtom(project.environmentId));
  const connected =
    presentation?.entry.enabled === true && presentation.connection.phase === "connected";
  const [open, setOpen] = useState(false);
  if (project.isScratch) return null;
  return (
    <>
      <Button
        label="Update folder location"
        tone="text"
        disabled={disabled || !connected || !canUpdate}
        accessibilityLabel={`Update folder location on ${computerLabel} at ${project.workspaceRoot}`}
        accessibilityHint={
          !connected
            ? "Connect this computer to update its folder location."
            : !canUpdate
              ? "This connection cannot change projects on this computer."
              : undefined
        }
        onPress={() => setOpen(true)}
      />
      {open ? (
        <FolderLocationEditor
          key={`${project.environmentId}:${project.id}:${project.workspaceRoot}`}
          project={project}
          computerLabel={computerLabel}
          disabled={disabled}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function FolderLocationEditor({
  project,
  computerLabel,
  disabled,
  onClose,
}: {
  readonly project: FolderTarget;
  readonly computerLabel: string;
  readonly disabled: boolean;
  readonly onClose: () => void;
}) {
  const registry = useContext(RegistryContext);
  const navigation = useNavigation();
  const authority = useLibraryAuthority();
  const config = useEnvironmentServerConfig(project.environmentId);
  const { presentation } = useEnvironmentPresentation(project.environmentId);
  const canRead = useEnvironmentScope(project.environmentId, AuthOrchestrationReadScope);
  const canUpdate = useAtomValue(projectEnvironment.update.permissionAtom(project.environmentId));
  const connected =
    presentation?.entry.enabled === true && presentation.connection.phase === "connected";
  const supported = supportsLoomFeature(
    config?.environment.capabilities,
    "project-checkout-management",
  );
  const copies = useEnvironmentQuery(
    authority.environmentId
      ? library.copies({
          environmentId: authority.environmentId,
          input: { includeReleased: true },
        })
      : null,
  );
  const checkout = useEnvironmentQuery(
    connected && supported && canRead
      ? checkouts.preview({
          environmentId: project.environmentId,
          input: { projectId: project.id },
        })
      : null,
  );
  const libraryCopy = copies.data?.find((copy) =>
    libraryProjectForLocalRefs(
      [],
      [{ environmentId: project.environmentId, projectId: project.id }],
      [copy],
      { includeInactiveCopies: true },
    ),
  );
  const reason = !connected
    ? "Connect this computer to update its folder location."
    : !canUpdate
      ? "This connection cannot change projects on this computer."
      : !canRead
        ? "This connection cannot check whether Loom manages this folder."
        : !supported
          ? "Update Loom on this computer before changing its folder location."
          : libraryCopy
            ? "Loom manages this location and its recovery. Open Project files to restore the files or choose another location."
            : !authority.loaded ||
                (authority.environmentId && (copies.error || !copies.isSuccess || copies.isPending))
              ? copies.error
                ? `Could not check Project working copies: ${copies.error}`
                : "Checking Project working copies…"
              : checkout.error || !checkout.isSuccess || checkout.isPending
                ? checkout.error
                  ? `Could not check folder management: ${checkout.error}`
                  : "Checking folder management…"
                : checkout.data?.projectId !== project.id ||
                    checkout.data.workspaceRoot !== project.workspaceRoot
                  ? "The saved folder changed. Close this editor and try again."
                  : checkout.data.ownershipSource !== null
                    ? "Loom manages this folder's location and recovery. Use Working files to review or restore it. Its location cannot be changed here."
                    : null;
  const update = useAtomCommand(projectEnvironment.update, { reportFailure: false });
  const [location, setLocation] = useState(project.workspaceRoot);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const nextLocation = location.trim();
  const canSave =
    !reason &&
    !disabled &&
    !saving &&
    nextLocation !== "" &&
    nextLocation !== project.workspaceRoot;
  const close = () => {
    if (!savingRef.current) onClose();
  };
  const save = async () => {
    if (!canSave || savingRef.current) return;
    if (!registry.get(projectEnvironment.update.permissionAtom(project.environmentId))) return;
    const current = registry.get(environmentPresentations.presentationAtom(project.environmentId));
    if (!current?.entry.enabled || current.connection.phase !== "connected") return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const result = await update({
      environmentId: project.environmentId,
      input: { projectId: project.id, workspaceRoot: nextLocation },
    });
    savingRef.current = false;
    setSaving(false);
    if (result._tag === "Success") onClose();
    else if (!isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      setError(
        failure instanceof Error ? failure.message : "Could not update the folder location.",
      );
    }
  };

  return (
    <Sheet title="Update folder location" dismissible={!saving} onClose={close}>
      <ScreenScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-4 p-4 pb-8"
      >
        <Text className="text-sm leading-normal text-foreground-muted">
          If this folder was renamed or moved on {computerLabel}, enter its current location. This
          changes the saved location only. Files stay in place, and your project and conversations
          are kept.
        </Text>
        <Text selectable className="text-xs leading-normal text-foreground-muted">
          Saved location: {project.workspaceRoot}
        </Text>
        {reason ? (
          <Text accessibilityLiveRegion="polite" className="text-sm text-foreground-muted">
            {reason}
          </Text>
        ) : (
          <View className="gap-2">
            <Text className="text-sm font-t3-medium text-foreground">
              Folder location on {computerLabel}
            </Text>
            <AppTextInput
              accessibilityLabel={`Folder location on ${computerLabel}`}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              value={location}
              editable={!saving}
              onChangeText={setLocation}
              onSubmitEditing={() => void save()}
              returnKeyType="done"
              className="min-h-12 rounded-xl border border-input-border bg-input px-3 text-sm text-foreground"
            />
            <Text className="text-xs leading-normal text-foreground-muted">
              The folder must already exist on {computerLabel}. No folders will be created or moved.
            </Text>
          </View>
        )}
        {error ? (
          <Text selectable accessibilityRole="alert" className="text-sm text-danger-foreground">
            {error}
          </Text>
        ) : null}
        {copies.error || checkout.error ? (
          <Button
            label="Retry checks"
            disabled={saving}
            onPress={() => {
              copies.refresh();
              checkout.refresh();
            }}
          />
        ) : null}
        {libraryCopy ? (
          <Button
            label="Open Project files"
            tone="text"
            disabled={saving}
            onPress={() => {
              close();
              navigation.navigate("LibraryProject", { projectId: libraryCopy.projectId });
            }}
          />
        ) : null}
        <View className="flex-row flex-wrap gap-2">
          <Button label="Cancel" disabled={saving} onPress={close} />
          <Button
            label={saving ? "Saving…" : "Save folder location"}
            tone="primary"
            disabled={!canSave}
            onPress={() => void save()}
          />
        </View>
      </ScreenScrollView>
    </Sheet>
  );
}
