import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";
import { threadWorkspaceIdle } from "../../orchestration-v2/queuedTurnStart.ts";

export function handoffThreadIdle(thread: OrchestrationV2ThreadShell, now: number): boolean {
  return (
    thread.archivedAt === null && thread.deletedAt === null && threadWorkspaceIdle(thread, now)
  );
}

/** Copy bounded, attributed context; the full original transcript remains on its host. */
export function handoffContext(
  messages: ReadonlyArray<{ readonly role: string; readonly text: string }>,
) {
  const sections = messages
    .filter((message) => message.text.trim() !== "")
    .map((message) => `${message.role}:\n${message.text}`);
  const complete = sections.join("\n\n");
  if (complete.length <= 64000) return { context: complete, contextTruncated: false };
  let first = sections[0]!.slice(0, 4000);
  if (/[\uD800-\uDBFF]$/.test(first)) first = first.slice(0, -1);
  let tail = complete.slice(-(64000 - first.length - 100));
  if (/^[\uDC00-\uDFFF]/.test(tail)) tail = tail.slice(1);
  return {
    context: `${first}\n\n[Older context omitted. The original conversation retains the full history.]\n\n${tail}`,
    contextTruncated: true,
  };
}

/** HTTPS clone URLs use the destination's credentials, never embedded source credentials. */
export function portableRemoteUrl(remote: string): string {
  try {
    const url = new URL(remote);
    if (url.protocol === "https:" || url.protocol === "http:") url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return remote;
  }
}
