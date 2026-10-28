import { useAtomValue } from "@effect/atom-react";
import { agentReceiptFacts, createAgentReceiptsAtoms } from "@t3tools/client-runtime/fork";
import type { EnvironmentId, NodeId, ThreadId } from "@t3tools/contracts";
import { type AgentReceipt, AgentReceiptError } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, type Atom } from "effect/reactivity";
import * as Schema from "effect/Schema";
import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useMarkdownPreviewStyles } from "../../features/files/FileMarkdownPreview";
import { cn } from "../../lib/cn";
import { SelectableMarkdownText } from "../../native/SelectableMarkdownText";
import { useOpenPullRequest } from "../../native/useOpenPullRequest";
import { appAtomRegistry } from "../../state/atom-registry";

const receipts = createAgentReceiptsAtoms(connectionAtomRuntime);
const FILES_SHOWN = 8;
const isReceiptError = Schema.is(AgentReceiptError);

/** The receipt is written just after the sub-agent finishes, so a new finish asks again. */
function useRefreshOn(atom: Atom.Atom<unknown>, key: string) {
  const seen = useRef(key);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refreshes the receipt atom in the app registry when the sub-agent's finish key changes
  useEffect(() => {
    if (key === seen.current) return;
    seen.current = key;
    appAtomRegistry.refresh(atom);
  }, [atom, key]);
}

/** A finished sub-agent's receipt below its row: what changed, what failed, the full result. */
export function SubagentReceipt(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly subagentId: NodeId;
  readonly finishedAt: string;
}) {
  const listAtom = receipts.list({
    environmentId: props.environmentId,
    input: { threadId: props.threadId },
  });
  useRefreshOn(listAtom, props.finishedAt);
  const summary =
    Option.getOrNull(AsyncResult.value(useAtomValue(listAtom)))?.find(
      (entry) => entry.subjectId === props.subagentId,
    ) ?? null;
  const [expanded, setExpanded] = useState(false);
  const facts = summary === null ? null : agentReceiptFacts(summary);
  return (
    <View className="gap-2 px-3 pb-2">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={facts === null ? "Receipt" : `Receipt, ${facts}`}
        accessibilityState={{ expanded }}
        onPress={() => {
          if (!expanded && summary === null) appAtomRegistry.refresh(listAtom);
          setExpanded((open) => !open);
        }}
        className="flex-row items-center gap-1 self-start rounded-md py-1 active:bg-subtle"
      >
        <SymbolView
          name={expanded ? "chevron.down" : "chevron.right"}
          size={10}
          tintColorClassName="accent-icon-subtle"
        />
        <Text
          numberOfLines={1}
          className={cn(
            "text-xs text-foreground-muted",
            (summary?.failedCommands ?? 0) > 0 && "text-destructive",
          )}
        >
          {facts === null ? "Receipt" : `Receipt · ${facts}`}
        </Text>
      </Pressable>
      {expanded ? <ReceiptDetail {...props} /> : null}
    </View>
  );
}

function ReceiptDetail(props: Parameters<typeof SubagentReceipt>[0]) {
  const result = useAtomValue(
    receipts.get({
      environmentId: props.environmentId,
      input: { threadId: props.threadId, subjectId: props.subagentId },
    }),
  );
  const receipt = Option.getOrNull(AsyncResult.value(result));
  if (receipt !== null) return <ReceiptBody receipt={receipt} />;
  const error = result._tag === "Failure" ? Cause.squash(result.cause) : null;
  return (
    <Text className="text-xs text-foreground-muted">
      {error === null
        ? "Loading the receipt…"
        : isReceiptError(error) && error.reason === "not-found"
          ? "No receipt yet."
          : "The receipt could not be loaded."}
    </Text>
  );
}

function ReceiptBody({ receipt }: { readonly receipt: AgentReceipt }) {
  const styles = useMarkdownPreviewStyles();
  const openLink = useOpenPullRequest();
  const files = receipt.files.slice(0, FILES_SHOWN);
  return (
    <View className="gap-2 rounded-lg border border-border bg-card/40 p-3">
      {receipt.commands.failed.length > 0 ? (
        <Text className="font-mono text-xs text-destructive">
          {receipt.commands.failed
            .map((command) => `exit ${command.exitCode ?? "?"} · ${command.input}`)
            .join("\n")}
        </Text>
      ) : null}
      {files.map((file) => (
        <Text key={file.path} numberOfLines={1} className="font-mono text-xs text-foreground-muted">
          {file.path}
        </Text>
      ))}
      {receipt.files.length > files.length ? (
        <Text className="text-xs text-foreground-muted">
          {`and ${receipt.files.length - files.length} more`}
        </Text>
      ) : null}
      {receipt.result.text.trim().length === 0 ? (
        <Text className="text-xs text-foreground-muted">No result was recorded.</Text>
      ) : (
        <SelectableMarkdownText
          markdown={receipt.result.text}
          textStyle={styles.nativeTextStyle}
          onLinkPress={(href) => void openLink(href)}
        />
      )}
    </View>
  );
}
