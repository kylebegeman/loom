import { useNavigation } from "@react-navigation/native";
import { classifyMarkdownImageSource } from "@t3tools/client-runtime/markdown-images";
import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import { toolCallLines, turnItemOutputText } from "@t3tools/client-runtime/work-log/item-detail";
import type { EnvironmentId } from "@t3tools/contracts";
import type { LibraryThreadArchive } from "@t3tools/contracts/fork";
import { memo, useCallback, useState } from "react";
import { Alert, View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { FilePreviewModal, type FilePreviewSource } from "../../components/FilePreviewModal";
import { Button } from "../../components/ui/Button";
import { useMarkdownPreviewStyles } from "../../features/files/FileMarkdownPreview";
import { resolveThreadActivityStatus } from "../../features/threads/thread-activity-row-presentation";
import {
  ThreadMarkdownImageUnavailable,
  ThreadMarkdownImageView,
} from "../../features/threads/ThreadMarkdownImage";
import {
  WorkLogBlock,
  WorkLogLabel,
  WorkLogPressable,
  WorkLogRows,
} from "../../features/threads/work-log-layout";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { workEntryRowLabel } from "../../lib/threadActivity";
import {
  SelectableMarkdownText,
  type MarkdownImageRenderer,
} from "../../native/SelectableMarkdownText";
import type { LibraryArchiveRow } from "./libraryArchive";

type ArchiveAttachment = {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
};

export function LibraryArchiveAttachment(props: {
  authorityEnvironmentId: EnvironmentId;
  sourceEnvironmentId: EnvironmentId;
  attachment: ArchiveAttachment;
  htmlRender?: boolean;
}) {
  const navigation = useNavigation();
  return (
    <Button
      label={`${props.attachment.name}${props.attachment.sizeBytes ? ` · ${formatAttachmentSize(props.attachment.sizeBytes)}` : ""}`}
      tone="secondary"
      onPress={() =>
        navigation.navigate("LibraryAttachment", {
          environmentId: props.authorityEnvironmentId,
          librarySourceEnvironmentId: props.sourceEnvironmentId,
          attachmentId: props.attachment.id,
          name: props.attachment.name,
          mimeType: props.attachment.mimeType,
          sizeBytes: String(props.attachment.sizeBytes),
          ...(props.htmlRender ? { htmlRender: "1" } : {}),
        })
      }
    />
  );
}

const CapturedMarkdown = memo(function CapturedMarkdown({ text }: { text: string }) {
  const { nativeTextStyle } = useMarkdownPreviewStyles();
  const [preview, setPreview] = useState<FilePreviewSource | null>(null);
  const renderImage = useCallback<MarkdownImageRenderer>((image) => {
    const source = classifyMarkdownImageSource(image.href);
    return source._tag === "Direct" ? (
      <ThreadMarkdownImageView
        uri={source.uri}
        sourceKey={source.uri}
        unavailable={false}
        alt={image.alt}
        onPressPreview={setPreview}
      />
    ) : (
      <ThreadMarkdownImageUnavailable alt={image.alt} />
    );
  }, []);
  return (
    <>
      <SelectableMarkdownText
        markdown={text}
        textStyle={nativeTextStyle}
        renderImage={renderImage}
        onLinkPress={(href) => {
          if (/^https?:\/\//i.test(href)) void tryOpenExternalUrl(href, "markdown-link");
          else
            Alert.alert(
              "Original computer files",
              "This link refers to the original workspace. Continue the conversation on that computer to open its files.",
            );
        }}
      />
      <FilePreviewModal source={preview} onRequestClose={() => setPreview(null)} />
    </>
  );
});

const LOG_PREVIEW_CHARACTERS = 16_000;

function SavedActivity({
  row,
  initiallyExpanded = false,
}: {
  row: Extract<LibraryArchiveRow, { type: "activity" }>;
  initiallyExpanded?: boolean | undefined;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [visibleCharacters, setVisibleCharacters] = useState(LOG_PREVIEW_CHARACTERS);
  const activity = row.activity,
    item = activity.projectedItem.item;
  const status = resolveThreadActivityStatus(item.status);
  let call = "";
  if (expanded && (item.type === "command_execution" || item.type === "dynamic_tool")) {
    const input = toolCallLines(
      item.type === "command_execution" ? { command: item.input } : { args: item.input },
    );
    call =
      input.command ??
      input.argsText ??
      input.args?.map(([key, value]) => `${key}: ${value}`).join("\n") ??
      "";
  }
  const output = expanded ? turnItemOutputText(item) : null;
  const detail = expanded
    ? item.type === "reasoning"
      ? item.text
      : item.type === "proposed_plan"
        ? item.markdown
        : (output ?? activity.detail ?? activity.getFullDetail())
    : null;
  return (
    <WorkLogBlock>
      <WorkLogRows>
        <WorkLogPressable
          accessibilityRole="button"
          accessibilityLabel={`${workEntryRowLabel(activity.workEntry)}. ${status.label}`}
          accessibilityState={{ expanded }}
          onPress={() => setExpanded((value) => !value)}
        >
          <SymbolView
            name={expanded ? "chevron.down" : "chevron.right"}
            size={12}
            tintColorClassName="accent-icon-muted"
          />
          <WorkLogLabel
            tone={
              status.tone === "danger"
                ? "danger"
                : status.tone === "warning"
                  ? "warning"
                  : "default"
            }
          >
            {workEntryRowLabel(activity.workEntry)}
          </WorkLogLabel>
          <Text className="text-xs text-foreground-muted">
            {status.tone === "active" ? `${status.label} when saved` : status.label}
          </Text>
        </WorkLogPressable>
        {expanded ? (
          <View className="gap-3 rounded-xl bg-subtle p-3">
            {call ? (
              <Text selectable className="font-mono text-xs text-foreground">
                {call.slice(0, visibleCharacters)}
              </Text>
            ) : null}
            {detail ? (
              item.type === "reasoning" || item.type === "proposed_plan" ? (
                <CapturedMarkdown text={detail.slice(0, visibleCharacters)} />
              ) : (
                <Text selectable className="font-mono text-xs leading-normal text-foreground">
                  {detail.slice(0, visibleCharacters)}
                </Text>
              )
            ) : null}
            {Math.max(call.length, detail?.length ?? 0) > visibleCharacters ? (
              <Button
                label="Show more saved detail"
                tone="text"
                onPress={() => setVisibleCharacters((value) => value + LOG_PREVIEW_CHARACTERS)}
              />
            ) : null}
            {activity.fetchesDetail ? (
              <Text className="text-xs text-foreground-muted">
                This saved snapshot does not include the full tool detail.
              </Text>
            ) : null}
            {!call && !detail ? (
              <Text className="text-xs text-foreground-muted">No further detail was recorded.</Text>
            ) : null}
          </View>
        ) : null}
      </WorkLogRows>
    </WorkLogBlock>
  );
}

export const LibraryArchiveFeedRow = memo(function LibraryArchiveFeedRow(props: {
  row: LibraryArchiveRow;
  archive: LibraryThreadArchive;
  authorityEnvironmentId: EnvironmentId;
  /** Opens the row, as for a proposed plan a history search matched. */
  initiallyExpanded?: boolean;
}) {
  const { row, archive, authorityEnvironmentId } = props;
  if (row.type === "activity")
    return <SavedActivity row={row} initiallyExpanded={props.initiallyExpanded} />;
  if (row.type === "html-render" || row.type === "mcp-app") {
    const title =
      row.type === "html-render" ? row.render.title : `${row.app.server}: ${row.app.tool}`;
    return (
      <View className="gap-2 py-3">
        <Text className="text-xs text-foreground-muted">
          Saved {row.type === "html-render" ? "page" : "app document"}
        </Text>
        <LibraryArchiveAttachment
          authorityEnvironmentId={authorityEnvironmentId}
          sourceEnvironmentId={archive.summary.environmentId}
          htmlRender={row.type === "html-render"}
          attachment={{
            id: row.type === "html-render" ? row.render.attachmentId : row.app.attachmentId,
            name: `${title}.html`,
            mimeType: "text/html",
            sizeBytes: 0,
          }}
        />
      </View>
    );
  }
  return (
    <View
      className={
        row.message.role === "user" ? "gap-3 rounded-2xl bg-subtle-strong p-4" : "gap-3 py-4"
      }
    >
      <Text className="text-xs font-t3-medium text-foreground-muted">
        {row.message.role === "user" ? "You" : "Agent"}
      </Text>
      {row.message.text ? <CapturedMarkdown text={row.message.text} /> : null}
      {row.message.attachments.map((attachment) => (
        <LibraryArchiveAttachment
          key={attachment.id}
          authorityEnvironmentId={authorityEnvironmentId}
          sourceEnvironmentId={archive.summary.environmentId}
          attachment={attachment}
        />
      ))}
    </View>
  );
});
