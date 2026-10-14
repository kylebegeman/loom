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
import { ListChoiceRow } from "../../../components/ListChoiceRow";
import { MaterialButton } from "../../../components/MaterialButton";
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
    <View className="gap-4 rounded-2xl bg-card p-4">
      <View className="gap-1">
        <Text accessibilityRole="header" className="text-base font-t3-semibold text-foreground">
          {confirmation
            ? "Confirm storage choices"
            : state.savedCount > 0
              ? "Folder results"
              : "Selected folders"}
        </Text>
        <Text className="text-sm text-foreground-muted">
          {state.savedCount > 0
            ? `${state.savedCount} saved · ${state.unfinished.length} unfinished${state.errorCount > 0 ? ` · ${state.errorCount} ${state.errorCount === 1 ? "needs" : "need"} another review` : ""}`
            : `${state.unfinished.length} selected. Review each folder, then choose its storage preference.`}
        </Text>
      </View>
      {confirmation ? (
        <>
          <Text className="text-sm leading-normal text-foreground-muted">
            {PROJECT_STORAGE_ROLLOUT_CONFIRMATION_NOTICE}
          </Text>
          {confirmation.entries.map((entry) => (
            <View key={entry.key} className="gap-1 rounded-xl bg-subtle p-3">
              <Text className="text-sm font-t3-medium text-foreground">
                {entry.target.projectName}
              </Text>
              <Text className="text-sm text-foreground-muted">{entry.target.environmentLabel}</Text>
              <Text selectable className="text-xs leading-normal text-foreground-muted">
                {entry.target.workspaceRoot}
              </Text>
              <Text className="text-sm font-t3-medium text-foreground">
                {PROJECT_STORAGE_ROLLOUT_RETENTION_LABELS[entry.choice]}
              </Text>
              <Text className="text-xs text-foreground-muted">
                {entry.operation === "adopt"
                  ? "Allow Loom to manage this folder"
                  : "Update existing preference"}
              </Text>
            </View>
          ))}
          <MaterialButton
            label={`Save ${confirmation.entries.length} ${confirmation.entries.length === 1 ? "choice" : "choices"}`}
            tone="primary"
            fullWidth
            onPress={() => void controller.save(confirmation)}
          />
          <MaterialButton
            label="Back to choices"
            tone="text"
            fullWidth
            onPress={() => controller.cancelConfirmation()}
          />
        </>
      ) : (
        <>
          {state.rows.map((row) => (
            <FolderReview key={row.key} row={row} busy={state.busy} controller={controller} />
          ))}
          {state.busy ? (
            <View className="gap-2">
              <Text accessibilityLiveRegion="polite" className="text-sm text-foreground-muted">
                {snapshot.cancelRequested
                  ? "Stopping after the current request finishes. Saved choices remain saved."
                  : snapshot.phase === "saving"
                    ? "Saving one folder at a time. Completed choices stay saved if another folder fails."
                    : "Reviewing one folder at a time. Working files stay unchanged."}
              </Text>
              <MaterialButton
                label={snapshot.phase === "saving" ? "Stop remaining saves" : "Stop review"}
                disabled={snapshot.cancelRequested}
                tone="text"
                fullWidth
                onPress={() => controller.cancel()}
              />
            </View>
          ) : state.unfinished.length > 0 ? (
            <View className="gap-2">
              {state.reviewable.length > 0 ? (
                <MaterialButton
                  label={
                    state.savedCount > 0 || state.errorCount > 0
                      ? "Review unfinished folders"
                      : "Review selected folders"
                  }
                  fullWidth
                  onPress={() => void controller.review(state.reviewable.map((row) => row.key))}
                />
              ) : null}
              <MaterialButton
                label="Continue to confirmation"
                disabled={!state.canConfirm}
                tone="primary"
                fullWidth
                onPress={() => controller.confirm()}
              />
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

function FolderReview({
  row,
  busy,
  controller,
}: {
  readonly row: ProjectStorageRolloutRow;
  readonly busy: boolean;
  readonly controller: ProjectStorageRolloutController;
}) {
  const preview = row.result ?? row.preview;
  const choices = projectStorageRolloutChoices(row);
  const reason = projectStorageRolloutTargetReason(row.target);
  const saved = row.status === "saved";
  return (
    <View className="gap-2 rounded-xl bg-subtle p-3">
      <View className="gap-1">
        <Text className="text-base font-t3-medium text-foreground">{row.target.projectName}</Text>
        <Text className="text-sm text-foreground-muted">{row.target.environmentLabel}</Text>
        <Text
          selectable
          numberOfLines={1}
          ellipsizeMode="middle"
          accessibilityLabel={row.target.workspaceRoot}
          className="text-xs leading-normal text-foreground-muted"
        >
          {row.target.workspaceRoot}
        </Text>
      </View>
      {saved ? (
        <Text accessibilityLiveRegion="polite" className="text-sm font-t3-medium text-foreground">
          Saved ·{" "}
          {row.result
            ? PROJECT_STORAGE_ROLLOUT_RETENTION_LABELS[row.result.retention]
            : "Storage preference saved"}
        </Text>
      ) : row.status === "reviewing" || row.status === "saving" ? (
        <Text accessibilityLiveRegion="polite" className="text-sm text-foreground-muted">
          {row.status === "reviewing" ? "Reviewing folder…" : "Saving choice…"}
        </Text>
      ) : null}
      {preview ? (
        <View className="gap-1">
          <Text className="text-sm text-foreground-muted">
            {projectStorageRolloutStateLabel(preview)}
          </Text>
          {preview.state !== "released" ? (
            <Text className="text-sm leading-normal text-foreground-muted">
              {projectStorageRolloutLocalFilesLabel(preview)}
            </Text>
          ) : null}
          {preview.branch ? (
            <Text className="text-xs text-foreground-muted">Branch: {preview.branch}</Text>
          ) : null}
          {[...new Set(preview.blockers)].map((blocker) => (
            <Text key={blocker} className="text-sm leading-normal text-foreground-muted">
              {blocker}
            </Text>
          ))}
        </View>
      ) : null}
      {!saved && reason ? (
        <Text className="text-sm leading-normal text-foreground-muted">{reason}</Text>
      ) : null}
      {row.error ? (
        <Text accessibilityLiveRegion="polite" className="text-sm leading-normal text-danger">
          {row.error}
        </Text>
      ) : null}
      {!saved && row.status === "reviewed" && choices.length === 0 && !reason ? (
        <Text className="text-sm leading-normal text-foreground-muted">
          {preview?.state === "blocked" || !preview?.reviewToken
            ? "Resolve the issues above and review this folder again."
            : "This connection can review the folder, but settings permission is required to save a choice."}
        </Text>
      ) : null}
      {!saved && choices.length > 0 ? (
        <View className="gap-2">
          <Text className="text-sm text-foreground-muted">
            Choose a preference for this folder.
          </Text>
          <View
            className="overflow-hidden rounded-xl"
            accessibilityRole="radiogroup"
            accessibilityLabel={`Storage choice for ${row.target.projectName} on ${row.target.environmentLabel} at ${row.target.workspaceRoot}`}
          >
            {choices.map((choice, index) => (
              <ListChoiceRow
                key={choice}
                label={PROJECT_STORAGE_ROLLOUT_RETENTION_LABELS[choice]}
                description={
                  choice === "keep"
                    ? "Keep working files available here."
                    : choice === "release-on-settle"
                      ? "Allow release after work settles and safety checks pass."
                      : "Follow this computer's current cleanup settings."
                }
                selected={row.choice === choice}
                separated={index > 0}
                disabled={busy}
                onPress={() => controller.choose(row.key, choice)}
              />
            ))}
          </View>
        </View>
      ) : null}
      {!saved ? (
        <View className="flex-row justify-end gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={row.status === "idle" ? "Review folder" : "Review folder again"}
            accessibilityHint={`${row.target.projectName} on ${row.target.environmentLabel}: ${row.target.workspaceRoot}`}
            accessibilityState={{ disabled: busy || !canReviewProjectStorageTarget(row.target) }}
            disabled={busy || !canReviewProjectStorageTarget(row.target)}
            onPress={() => void controller.review([row.key])}
            className="min-h-11 justify-center rounded-lg px-3 active:opacity-70"
          >
            <Text
              className={
                busy || !canReviewProjectStorageTarget(row.target)
                  ? "text-sm font-t3-medium text-foreground-muted"
                  : "text-sm font-t3-medium text-primary-text"
              }
            >
              {row.status === "idle" ? "Review" : "Review again"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Remove from selection"
            accessibilityHint={`${row.target.projectName} on ${row.target.environmentLabel}: ${row.target.workspaceRoot}`}
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={() => controller.setSelected(row.key, false)}
            className="min-h-11 justify-center rounded-lg px-3 active:opacity-70"
          >
            <Text
              className={
                busy
                  ? "text-sm font-t3-medium text-foreground-muted"
                  : "text-sm font-t3-medium text-primary-text"
              }
            >
              Remove
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
