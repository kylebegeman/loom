import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CircleAlertIcon, SparklesIcon } from "lucide-react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { BotDraftResult } from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Button } from "~/components/ui/button";
import { useThreadShell } from "~/state/entities";
import { useAtomCommand } from "~/state/use-atom-command";
import { LibraryNotice } from "../../project-library/LibraryControls";
import { BotEditorForm, BotEditorSkeleton } from "../BotEditor";
import { BotTile } from "../BotIdentity";
import { bots, useBots } from "../state";

type Loaded =
  | { readonly _tag: "loading" }
  | { readonly _tag: "ready"; readonly result: BotDraftResult }
  | { readonly _tag: "failed"; readonly message: string };

/** The editor's header while there is no draft to edit yet, so the page keeps its shape. */
function DraftHeader({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const thread = useThreadShell({ environmentId, threadId });
  return (
    <header className="flex min-w-0 items-center gap-3">
      <BotTile bot={{ id: "new-bot" }} size="md" />
      <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
        From{" "}
        <Link
          to="/$environmentId/$threadId"
          params={{ environmentId, threadId }}
          className="rounded-sm text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          {thread?.title ?? "its thread"}
        </Link>
      </p>
    </header>
  );
}

/**
 * Drafts once per thread, fresh each time the page opens, so the drafted id is still free when
 * it is saved.
 */
function FromThreadDraft({
  environmentId,
  threadId,
  suggestionId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly suggestionId: string | null;
}) {
  const draftFromThread = useAtomCommand(bots.draftFromThread, { reportFailure: false });
  const [loaded, setLoaded] = useState<Loaded>({ _tag: "loading" });
  // Only the newest request may settle the page, so a draft for an abandoned visit is dropped.
  const request = useRef(0);

  const fetchDraft = () => {
    const attempt = ++request.current;
    void draftFromThread({ environmentId, input: { threadId } }).then(
      (result) => {
        if (attempt !== request.current) return;
        if (result._tag === "Success") return setLoaded({ _tag: "ready", result: result.value });
        const cause = squashAtomCommandFailure(result);
        setLoaded({
          _tag: "failed",
          message:
            cause instanceof Error && cause.message
              ? cause.message
              : "Could not draft a bot from this thread.",
        });
      },
      () => {
        if (attempt === request.current)
          setLoaded({ _tag: "failed", message: "Could not draft a bot from this thread." });
      },
    );
  };
  const draftOnOpen = useEffectEvent(fetchDraft);
  useEffect(() => {
    draftOnOpen();
    return () => {
      request.current += 1;
    };
  }, []);

  if (loaded._tag === "ready")
    return (
      <BotEditorForm
        environmentId={environmentId}
        bot={null}
        fromThread={loaded.result}
        suggestionId={suggestionId}
      />
    );
  return (
    <div className="flex min-w-0 flex-col">
      <DraftHeader environmentId={environmentId} threadId={threadId} />
      <div className="mt-5">
        {loaded._tag === "failed" ? (
          <LibraryNotice
            icon={CircleAlertIcon}
            tone="danger"
            action={
              <Button
                shape="pill"
                size="xs"
                variant="outline"
                onClick={() => {
                  setLoaded({ _tag: "loading" });
                  fetchDraft();
                }}
              >
                Try again
              </Button>
            }
          >
            {loaded.message}
          </LibraryNotice>
        ) : (
          <LibraryNotice icon={SparklesIcon}>
            Drafting a bot from the thread's first message…
          </LibraryNotice>
        )}
      </div>
      {loaded._tag === "loading" ? <BotEditorSkeleton /> : null}
    </div>
  );
}

/** The bot editor as a full page, opened on a draft made from a thread. */
export function BotFromThreadPage({
  threadId,
  suggestionId,
}: {
  readonly threadId: ThreadId;
  readonly suggestionId: string | null;
}) {
  const { host } = useBots();
  if (host.environmentId === null) return null;
  if (!host.fromThreadSupported)
    return (
      <div className="flex min-w-0 flex-col">
        <DraftHeader environmentId={host.environmentId} threadId={threadId} />
        <div className="mt-5">
          <LibraryNotice icon={CircleAlertIcon}>
            This server cannot draft bots from threads. Update it, or start a new bot from Bots.
          </LibraryNotice>
        </div>
      </div>
    );
  return (
    <FromThreadDraft
      key={`${host.environmentId}:${threadId}`}
      environmentId={host.environmentId}
      threadId={threadId}
      suggestionId={suggestionId}
    />
  );
}
