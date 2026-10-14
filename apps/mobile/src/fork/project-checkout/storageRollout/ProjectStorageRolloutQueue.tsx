import {
  canReviewProjectStorageTarget,
  PROJECT_STORAGE_ROLLOUT_CONFIRMATION_NOTICE,
  PROJECT_STORAGE_ROLLOUT_RETENTION_LABELS,
  projectStorageRolloutChoices,
  projectStorageRolloutLocalFilesLabel,
  projectStorageRolloutStateLabel,
  projectStorageRolloutTargetReason,
  type ProjectStorageRolloutController,
  type ProjectStorageRolloutRow,
  type ProjectStorageRolloutSnapshot,
} from "@t3tools/client-runtime/fork";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../../components/AppText";
import { SymbolView } from "../../../components/AppSymbol";
import { ControlPillMenu } from "../../../components/ControlPill";
import { MaterialButton } from "../../../components/MaterialButton";
import { SettingsSection } from "../../../features/settings/components/SettingsSection";
import { projectStorageRolloutQueueState } from "./projectStorageRolloutQueueState";

type Props = {
  readonly controller: ProjectStorageRolloutController;
  readonly snapshot: ProjectStorageRolloutSnapshot;
};

export function ProjectStorageRolloutQueue({ controller, snapshot }: Props) {
  const state = projectStorageRolloutQueueState(snapshot);
  if (state.rows.length === 0) return null;
  const confirmation = snapshot.confirmation;
  return (
    <View className="gap-3">
      <SettingsSection
        title={
          confirmation
            ? "Confirm file choices"
            : state.savedCount > 0
              ? "Saved file choices"
              : "Selected working files"
        }
        trailing={
          <Text className="px-2 text-xs tabular-nums text-foreground-muted">
            {state.savedCount > 0
              ? `${state.savedCount} saved · ${state.unfinished.length} unfinished`
              : `${state.unfinished.length} selected`}
          </Text>
        }
      >
        {confirmation
          ? confirmation.entries.map((entry, index) => (
              <View
                key={entry.key}
                className={
                  index === 0 ? "gap-1 px-4 py-3" : "gap-1 border-t border-border-subtle px-4 py-3"
                }
              >
                <Text className="text-sm font-t3-medium text-foreground">
                  {entry.target.projectName}
                </Text>
                <Text className="text-xs text-foreground-muted">
                  Working files on {entry.target.environmentLabel} ·{" "}
                  {entry.operation === "adopt" ? "Enable file controls" : "Update preference"}
                </Text>
                <Text selectable className="text-xs leading-normal text-foreground-muted">
                  Location: {entry.target.workspaceRoot}
                </Text>
                <Text className="text-sm font-t3-medium text-foreground">
                  {PROJECT_STORAGE_ROLLOUT_RETENTION_LABELS[entry.choice]}
                </Text>
              </View>
            ))
          : state.rows.map((row, index) => (
              <FolderReview
                key={row.key}
                row={row}
                busy={state.busy}
                controller={controller}
                separated={index > 0}
              />
            ))}
      </SettingsSection>
      {confirmation ? (
        <>
          <Text className="px-2 text-xs leading-normal text-foreground-muted">
            {PROJECT_STORAGE_ROLLOUT_CONFIRMATION_NOTICE}
          </Text>
          <View className="flex-row flex-wrap items-center gap-2">
            <MaterialButton
              label={`Save ${confirmation.entries.length} ${confirmation.entries.length === 1 ? "choice" : "choices"}`}
              tone="primary"
              onPress={() => void controller.save(confirmation)}
            />
            <MaterialButton
              label="Back to choices"
              tone="text"
              onPress={() => controller.cancelConfirmation()}
            />
          </View>
        </>
      ) : state.busy ? (
        <View className="gap-2">
          <Text accessibilityLiveRegion="polite" className="px-2 text-xs text-foreground-muted">
            {snapshot.cancelRequested
              ? "Stopping after this request. Saved choices stay saved."
              : snapshot.phase === "saving"
                ? "Saving one location at a time. Completed choices stay saved."
                : "Checking one location at a time. Working files stay unchanged."}
          </Text>
          <MaterialButton
            label={snapshot.phase === "saving" ? "Stop remaining saves" : "Stop review"}
            disabled={snapshot.cancelRequested}
            tone="text"
            onPress={() => controller.cancel()}
          />
        </View>
      ) : state.unfinished.length > 0 ? (
        <View className="gap-2">
          {state.errorCount > 0 ? (
            <Text accessibilityLiveRegion="polite" className="px-2 text-xs text-foreground-muted">
              {state.errorCount} {state.errorCount === 1 ? "location needs" : "locations need"}{" "}
              another review. Saved choices stay saved.
            </Text>
          ) : null}
          <View className="flex-row flex-wrap items-center gap-2">
            {state.reviewable.length > 0 ? (
              <MaterialButton
                label={
                  state.savedCount > 0 || state.errorCount > 0
                    ? "Check unfinished locations"
                    : "Check selected files"
                }
                onPress={() => void controller.review(state.reviewable.map((row) => row.key))}
              />
            ) : null}
            <MaterialButton
              label="Continue to confirmation"
              disabled={!state.canConfirm}
              tone="primary"
              onPress={() => controller.confirm()}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function FolderReview({
  row,
  busy,
  controller,
  separated,
}: {
  readonly row: ProjectStorageRolloutRow;
  readonly busy: boolean;
  readonly controller: ProjectStorageRolloutController;
  readonly separated: boolean;
}) {
  const preview = row.result ?? row.preview;
  const choices = projectStorageRolloutChoices(row);
  const reason = projectStorageRolloutTargetReason(row.target);
  const saved = row.status === "saved";
  return (
    <View className={separated ? "border-t border-border-subtle" : undefined}>
      <View className="gap-2 px-4 pt-3 pb-2">
        <View className="flex-row items-start gap-2">
          <View className="min-w-0 flex-1 gap-0.5">
            <Text className="text-sm font-t3-medium text-foreground" numberOfLines={1}>
              {row.target.projectName}
            </Text>
            <Text className="text-xs text-foreground-muted">
              Working files on {row.target.environmentLabel}
              {preview ? ` · ${projectStorageRolloutStateLabel(preview)}` : ""}
            </Text>
            <Text
              selectable
              numberOfLines={1}
              ellipsizeMode="middle"
              accessibilityLabel={row.target.workspaceRoot}
              className="text-xs text-foreground-muted"
            >
              Location: {row.target.workspaceRoot}
            </Text>
          </View>
          {!saved ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Remove from selection"
              accessibilityHint={`${row.target.projectName} on ${row.target.environmentLabel}: ${row.target.workspaceRoot}`}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={() => controller.setSelected(row.key, false)}
              className="size-11 items-center justify-center rounded-full active:opacity-70"
            >
              <SymbolView name="xmark" size={14} tintColorClassName="accent-icon-muted" />
            </Pressable>
          ) : null}
        </View>
        {saved ? (
          <Text accessibilityLiveRegion="polite" className="text-sm font-t3-medium text-foreground">
            Saved ·{" "}
            {row.result
              ? PROJECT_STORAGE_ROLLOUT_RETENTION_LABELS[row.result.retention]
              : "File choice saved"}
          </Text>
        ) : row.status === "reviewing" || row.status === "saving" ? (
          <Text accessibilityLiveRegion="polite" className="text-xs text-foreground-muted">
            {row.status === "reviewing" ? "Checking working files…" : "Saving choice…"}
          </Text>
        ) : null}
        {preview ? (
          <View className="gap-1">
            {preview.state !== "released" ? (
              <Text className="text-xs leading-normal text-foreground-muted">
                {projectStorageRolloutLocalFilesLabel(preview)}
                {preview.branch ? ` · ${preview.branch}` : ""}
              </Text>
            ) : null}
            {[...new Set(preview.blockers)].map((blocker) => (
              <Text key={blocker} className="text-xs leading-normal text-foreground-muted">
                {blocker}
              </Text>
            ))}
          </View>
        ) : null}
        {!saved && reason ? (
          <Text className="text-xs leading-normal text-foreground-muted">{reason}</Text>
        ) : null}
        {row.error ? (
          <Text
            accessibilityLiveRegion="polite"
            className="text-xs leading-normal text-danger-foreground"
          >
            {row.error}
          </Text>
        ) : null}
        {!saved && row.status === "reviewed" && choices.length === 0 && !reason ? (
          <Text className="text-xs leading-normal text-foreground-muted">
            {preview?.state === "blocked" || !preview?.reviewToken
              ? "Resolve the issues above and check these working files again."
              : "Settings permission is required to save a choice."}
          </Text>
        ) : null}
      </View>
      {!saved && choices.length > 0 ? (
        <ControlPillMenu
          accessible
          accessibilityRole="button"
          accessibilityLabel={`Storage choice for ${row.target.projectName} on ${row.target.environmentLabel} at ${row.target.workspaceRoot}. ${row.choice ? PROJECT_STORAGE_ROLLOUT_RETENTION_LABELS[row.choice] : "Choose what stays here"}`}

          title="What stays on this computer?"
          actions={choices.map((choice) => ({
            id: choice,
            title: PROJECT_STORAGE_ROLLOUT_RETENTION_LABELS[choice],
            subtitle:
              choice === "keep"
                ? "Keep this project's working files on this computer."
                : choice === "release-on-settle"
                  ? "Remove safe settled files; restore them when you resume work."
                  : "Use this computer's default for keeping or removing files.",
            state: row.choice === choice ? ("on" as const) : ("off" as const),
            attributes: { disabled: busy },
          }))}
          onPressAction={({ nativeEvent }) => {
            const choice = choices.find((entry) => entry === nativeEvent.event);
            if (choice && !busy) controller.choose(row.key, choice);
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Storage preference: ${row.choice ? PROJECT_STORAGE_ROLLOUT_RETENTION_LABELS[row.choice] : "Choose what stays here"}`}
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            className="min-h-11 flex-row flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 active:opacity-70 disabled:opacity-40"
          >
            <Text className="text-xs text-foreground-muted">After settling</Text>
            <View className="flex-row items-center gap-2">
              <Text className="text-sm text-primary-text">
                {row.choice
                  ? PROJECT_STORAGE_ROLLOUT_RETENTION_LABELS[row.choice]
                  : "Choose what stays here"}
              </Text>
              <SymbolView name="chevron.down" size={12} tintColorClassName="accent-primary-text" />
            </View>
          </Pressable>
        </ControlPillMenu>
      ) : null}
      {!saved && row.choice ? (
        <Text className="px-4 pb-2 text-xs leading-normal text-foreground-muted">
          {row.choice === "release-on-settle"
            ? "Loom can remove these safe working files after work settles, then restore them when you resume work."
            : row.choice === "keep"
              ? "Keep this project's working files on this computer."
              : "Follow this computer's default for keeping or removing settled working files."}
        </Text>
      ) : null}
      {!saved ? (
        <View className="flex-row justify-end px-1 pb-1">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              row.status === "idle" ? "Check working files" : "Check working files again"
            }
            accessibilityHint={`${row.target.projectName} on ${row.target.environmentLabel}: ${row.target.workspaceRoot}`}
            accessibilityState={{ disabled: busy || !canReviewProjectStorageTarget(row.target) }}
            disabled={busy || !canReviewProjectStorageTarget(row.target)}
            onPress={() => void controller.review([row.key])}
            className="min-h-11 justify-center rounded-lg px-3 active:opacity-70"
          >
            <Text
              className={
                busy || !canReviewProjectStorageTarget(row.target)
                  ? "text-xs font-t3-medium text-foreground-muted"
                  : "text-xs font-t3-medium text-primary-text"
              }
            >
              {row.status === "idle" ? "Check files" : "Check again"}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
