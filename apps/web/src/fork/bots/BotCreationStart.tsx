import { useRef, useState } from "react";
import type { EnvironmentId, ModelSelection } from "@t3tools/contracts";
import { ProjectId } from "@t3tools/contracts";
import {
  isBotRunThreadId,
  type BotImportedDraft,
  type BotStarterId,
} from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  FileTextIcon,
  LayersIcon,
  LockIcon,
  MessageSquareIcon,
  UploadIcon,
  WorkflowIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Radio, RadioGroup } from "~/components/ui/radio-group";
import { cn } from "~/lib/utils";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { scheduledTaskDefaultModel } from "~/components/settings/scheduledTasksSettings.logic";
import { useProjects, useThreadShells } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  LibraryErrorNotice,
  LibraryNotice,
  LibrarySection,
  LibraryStateBadge,
} from "../project-library/LibraryControls";
import { BotModelPicker, useBotModelChoices } from "./BotModelPicker";
import { useBotsNavigation } from "./navigation";
import { bots, useBotsAccess, useBotsHost } from "./state";

const STARTING_POINTS = [
  {
    value: "prompt",
    title: "Prompt or snippet",
    detail: "Instructions you already use",
    icon: FileTextIcon,
  },
  {
    value: "thread",
    title: "Conversation",
    detail: "A job from your thread history",
    icon: MessageSquareIcon,
  },
  {
    value: "starter",
    title: "Starter",
    detail: "Review, verify or resolve a conflict",
    icon: LayersIcon,
  },
] as const;
type StartingPoint = (typeof STARTING_POINTS)[number]["value"];

export function BotCreationStart({
  environmentId,
  onDraft,
  onBlank,
}: {
  readonly environmentId: EnvironmentId;
  readonly onDraft: (draft: BotImportedDraft) => void;
  readonly onBlank: () => void;
}) {
  const nav = useBotsNavigation();
  const access = useBotsAccess();
  const host = useBotsHost();
  const choices = useBotModelChoices(environmentId);
  const defaultModel = scheduledTaskDefaultModel(choices.settings, null, choices.instanceEntries);
  const [selectedModel, setModel] = useState<ModelSelection | null>(null);
  const modelSelection = selectedModel ?? defaultModel;
  const projects = useProjects().filter(
    (entry) => entry.environmentId === environmentId && !entry.isScratch,
  );
  const threads = useThreadShells().filter(
    (entry) => entry.environmentId === environmentId && !isBotRunThreadId(entry.id),
  );
  const starters = useEnvironmentQuery(bots.listStarters({ environmentId, input: {} }));
  const [point, setPoint] = useState<StartingPoint>("prompt");
  const [text, setText] = useState("");
  const [project, setProject] = useState("");
  const [threadId, setThread] = useState("");
  const [starterId, setStarter] = useState<BotStarterId | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<ReadonlyArray<BotImportedDraft>>([]);
  const [notes, setNotes] = useState<ReadonlyArray<string>>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const importText = useAtomCommand(bots.draftFromText, { reportFailure: false });
  const importStarter = useAtomCommand(bots.draftFromStarter, { reportFailure: false });
  const read = async () => {
    if (busy || !modelSelection || !access.canSave) return;
    setBusy(true);
    setError(null);
    setDrafts([]);
    await (async () => {
      const context = {
        modelSelection,
        ...(project ? { projectId: ProjectId.make(project) } : {}),
      };
      if (point === "starter") {
        if (!starterId) return;
        const result = await importStarter({ environmentId, input: { ...context, starterId } });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        onDraft(result.value);
      } else {
        const result = await importText({ environmentId, input: { ...context, text } });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        if (result.value.drafts.length === 1) onDraft(result.value.drafts[0]!);
        else {
          setDrafts(result.value.drafts);
          setNotes(result.value.notes);
        }
      }
    })()
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Could not prepare the bot draft."),
      )
      .finally(() => setBusy(false));
  };
  return (
    <div className="flex min-w-0 flex-col gap-7">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl space-y-2">
          <h2 className="text-2xl font-semibold tracking-tight">
            Start with a job you already know
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Turn a repeatable brief into a bot. Review its instructions, inputs and permissions
            before saving your first version.
          </p>
        </div>
        <Button
          variant="outline"
          shape="pill"
          size="sm"
          disabled={busy || !access.canSave}
          onClick={onBlank}
        >
          Write from scratch
        </Button>
      </header>
      <RadioGroup
        aria-label="Bot starting point"
        value={point}
        disabled={busy}
        className="grid sm:grid-cols-3"
        onValueChange={(value) => {
          if (value !== "prompt" && value !== "thread" && value !== "starter") return;
          setPoint(value);
          setError(null);
          setDrafts([]);
        }}
      >
        {STARTING_POINTS.map(({ value, title, detail, icon: Icon }) => (
          <label
            key={value}
            className={cn(
              "flex min-w-0 cursor-pointer items-start gap-3 rounded-xl border p-4",
              point === value
                ? "border-foreground/20 bg-muted/35"
                : "border-border/60 hover:bg-muted/20",
            )}
          >
            <Radio value={value} />
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="flex items-center gap-2 text-sm font-medium">
                <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                {title}
              </span>
              <span className="text-xs leading-relaxed text-muted-foreground">{detail}</span>
            </span>
          </label>
        ))}
      </RadioGroup>
      {!access.canSave ? (
        <LibraryNotice icon={LockIcon}>
          This connection can view bots but cannot create them.
        </LibraryNotice>
      ) : null}
      <section
        aria-label="Prepare a bot draft"
        className="grid gap-6 rounded-2xl bg-muted/20 p-5 sm:p-6"
      >
        {point === "thread" ? (
          <div className="grid max-w-2xl gap-4">
            <div className="space-y-1">
              <h3 className="font-medium">Use a conversation</h3>
              <p className="text-sm text-muted-foreground">
                Its opening request becomes an editable brief.
              </p>
            </div>
            <label htmlFor="bot-source-thread" className="sr-only">
              Conversation
            </label>
            <Select value={threadId || null} onValueChange={(value) => setThread(value ?? "")}>
              <SelectTrigger id="bot-source-thread">
                <SelectValue placeholder="Choose a conversation" />
              </SelectTrigger>
              <SelectPopup>
                {threads.map((thread) => (
                  <SelectItem key={thread.id} value={thread.id}>
                    {thread.title}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            {!threads.length ? (
              <p className="text-sm text-muted-foreground">
                Open a conversation on this computer to use it as a starting point.
              </p>
            ) : null}
            <div>
              <Button
                shape="pill"
                disabled={!threadId || !access.canSave}
                onClick={() => nav.open({ fromThread: threadId as (typeof threads)[number]["id"] })}
              >
                Draft from conversation
              </Button>
            </div>
          </div>
        ) : (
          <>
            {point === "prompt" ? (
              <div className="grid gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label htmlFor="bot-import-text" className="font-medium">
                    What should this bot do?
                  </label>
                  <Button
                    variant="outline"
                    shape="pill"
                    size="xs"
                    onClick={() => fileInput.current?.click()}
                    disabled={busy}
                  >
                    <UploadIcon /> Import a file
                  </Button>
                </div>
                <Textarea
                  id="bot-import-text"
                  value={text}
                  rows={8}
                  maxLength={100_000}
                  onChange={(event) => {
                    setText(event.target.value);
                    setDrafts([]);
                  }}
                  placeholder="Review {{target}} for correctness. Report findings with evidence and leave files unchanged."
                />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Use {"{{target}}"} for anything that changes between runs. Import plain text,
                  Markdown, loom-snippet or a snippets.json collection.
                </p>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".txt,.md,.markdown,.json,text/plain,text/markdown,application/json"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    if (file.size > 400_000) {
                      setError("Choose a file smaller than 400 KB.");
                      return;
                    }
                    void file
                      .text()
                      .then((value) => {
                        if (value.length > 100_000)
                          setError("Import at most 100,000 characters at a time.");
                        else {
                          setText(value);
                          setError(null);
                          setDrafts([]);
                        }
                      })
                      .catch(() => setError("This file could not be read. Try pasting its text."));
                  }}
                />
              </div>
            ) : (
              <div className="grid max-w-2xl gap-3">
                <div className="space-y-1">
                  <label htmlFor="bot-import-starter" className="font-medium">
                    Choose a starter
                  </label>
                  <p className="text-sm text-muted-foreground">
                    A separate draft with typed inputs, ready for your review.
                  </p>
                </div>
                <Select
                  value={starterId}
                  onValueChange={(value) => setStarter(value as BotStarterId | null)}
                >
                  <SelectTrigger id="bot-import-starter">
                    <SelectValue placeholder="Choose a starter" />
                  </SelectTrigger>
                  <SelectPopup>
                    {starters.data?.starters.map((starter) => (
                      <SelectItem key={starter.starterId} value={starter.starterId}>
                        {starter.name}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                <LibraryErrorNotice error={starters.error} onRetry={starters.refresh} />
              </div>
            )}
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="grid gap-2">
                <span className="text-sm font-medium">Model</span>
                <BotModelPicker
                  environmentId={environmentId}
                  value={modelSelection}
                  onChange={setModel}
                />
              </div>
              <div className="grid gap-2">
                <label htmlFor="bot-import-project" className="text-sm font-medium">
                  Project
                </label>
                <Select value={project} onValueChange={(value) => setProject(value ?? "")}>
                  <SelectTrigger id="bot-import-project">
                    <SelectValue>
                      {projects.find((entry) => entry.id === project)?.title ?? "Scratch folder"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value="">Scratch folder</SelectItem>
                    {projects.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {entry.title}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="max-w-lg text-xs leading-relaxed text-muted-foreground">
                Drafts require approval before actions. Saving a bot does not run it or enable a
                schedule.
              </p>
              <Button
                shape="pill"
                disabled={
                  busy ||
                  !modelSelection ||
                  !access.canSave ||
                  (point === "prompt" ? !text.trim() : !starterId)
                }
                onClick={() => void read()}
              >
                {busy ? "Preparing draft…" : "Review draft"}
              </Button>
            </div>
          </>
        )}
        <LibraryErrorNotice error={error} />
      </section>
      {notes.length ? (
        <LibraryNotice icon={FileTextIcon}>
          <ul className="grid gap-1">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </LibraryNotice>
      ) : null}
      {drafts.length ? (
        <LibrarySection title="Choose a snippet to review" count={drafts.length}>
          <div className="divide-y divide-border/60" aria-live="polite">
            {drafts.map((entry) => (
              <div
                key={entry.draft.id}
                className="flex flex-wrap items-center justify-between gap-4 py-4"
              >
                <div className="min-w-0 flex-1 basis-64 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-medium">{entry.draft.name}</h3>
                    <LibraryStateBadge tone={entry.intent === "edits" ? "warning" : "neutral"}>
                      {entry.intent === "edits"
                        ? "Requests changes"
                        : entry.intent === "planning"
                          ? "Planning"
                          : "Review permissions"}
                    </LibraryStateBadge>
                  </div>
                  <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                    {entry.draft.description || entry.draft.instructions.slice(0, 160)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {entry.draft.parameters.length}{" "}
                    {entry.draft.parameters.length === 1 ? "input" : "inputs"} to review
                  </p>
                </div>
                <Button shape="pill" size="sm" variant="outline" onClick={() => onDraft(entry)}>
                  Review draft
                </Button>
              </div>
            ))}
          </div>
        </LibrarySection>
      ) : null}
      {host.pipelinesSupported ? (
        <div className="flex flex-wrap items-center gap-4 py-2">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <WorkflowIcon aria-hidden className="size-4" />
          </span>
          <div className="min-w-0 flex-1 basis-64 space-y-1">
            <h3 className="text-sm font-medium">Several bots, one workflow</h3>
            <p className="text-sm text-muted-foreground">
              Start from a saved pipeline, then review its inputs, gates and stop conditions.
            </p>
          </div>
          <Button
            variant="outline"
            shape="pill"
            size="sm"
            disabled={busy || !access.canSavePipelines}
            onClick={() => nav.open({ newPipeline: true })}
          >
            Build an automation
          </Button>
        </div>
      ) : null}
    </div>
  );
}
