import { useRef, useState } from "react";
import type { EnvironmentId, ModelSelection } from "@t3tools/contracts";
import { ProjectId } from "@t3tools/contracts";
import {
  isBotRunThreadId,
  type BotImportedDraft,
  type BotStarterId,
} from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Button } from "~/components/ui/button";
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
import { BotModelPicker, useBotModelChoices } from "./BotModelPicker";
import { useBotsNavigation } from "./navigation";
import { bots, useBotsAccess, useBotsHost } from "./state";

type StartingPoint = "prompt" | "thread" | "starter";

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
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Give a repeatable job its own bot</h2>
        <p className="text-sm text-muted-foreground">
          Start with instructions you already use, a conversation or a starter. Review the draft
          before saving. Creating a bot does not run it or enable an automation.
        </p>
      </div>
      <div aria-label="Bot starting point" className="flex flex-wrap gap-2">
        {(
          [
            ["prompt", "From prompt or snippet"],
            ["thread", "From thread"],
            ["starter", "Starter"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            variant={point === value ? "default" : "outline"}
            size="sm"
            aria-pressed={point === value}
            disabled={busy}
            onClick={() => {
              setPoint(value);
              setError(null);
              setDrafts([]);
            }}
          >
            {label}
          </Button>
        ))}
        <Button variant="outline" size="sm" disabled={busy || !access.canSave} onClick={onBlank}>
          Blank
        </Button>
      </div>
      {point === "thread" ? (
        <div className="flex flex-col gap-3">
          <label htmlFor="bot-source-thread" className="text-sm font-medium">
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
              Open a conversation on this computer first. Its opening request becomes the draft.
            </p>
          ) : null}
          <div>
            <Button
              disabled={!threadId || !access.canSave}
              onClick={() => nav.open({ fromThread: threadId as (typeof threads)[number]["id"] })}
            >
              Draft from thread
            </Button>
          </div>
        </div>
      ) : (
        <>
          {point === "prompt" ? (
            <div className="flex flex-col gap-3">
              <label htmlFor="bot-import-text" className="text-sm font-medium">
                Instructions or snippet export
              </label>
              <Textarea
                id="bot-import-text"
                value={text}
                rows={9}
                maxLength={100_000}
                onChange={(event) => {
                  setText(event.target.value);
                  setDrafts([]);
                }}
                placeholder="Describe the job and use {{target}} for anything that changes between runs."
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInput.current?.click()}
                  disabled={busy}
                >
                  Choose a text file
                </Button>
                <p className="text-xs text-muted-foreground">
                  Plain text, Markdown, loom-snippet or snippets.json. Existing placeholders become
                  inputs.
                </p>
              </div>
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
            <div className="flex flex-col gap-3">
              <label htmlFor="bot-import-starter" className="text-sm font-medium">
                Starter
              </label>
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
              {starters.error ? (
                <p role="alert" className="text-sm text-destructive-foreground">
                  {starters.error}
                </p>
              ) : null}
              <p className="text-sm text-muted-foreground">
                Creates a separate draft with the starter's typed inputs. Your saved bots stay as
                they are.
              </p>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Model</span>
              <BotModelPicker
                environmentId={environmentId}
                value={modelSelection}
                onChange={setModel}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="bot-import-project" className="text-sm font-medium">
                Project
              </label>
              <Select value={project} onValueChange={(value) => setProject(value ?? "")}>
                <SelectTrigger id="bot-import-project">
                  <SelectValue />
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
          <p className="text-sm text-muted-foreground">
            Drafts start with approval required. Instructions that ask for fixes still need you to
            review editing permissions. Schedules are configured separately after saving.
          </p>
          <div>
            <Button
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
      {host.pipelinesSupported ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-border p-4">
          <p className="text-sm font-medium">Need several bots to work in sequence?</p>
          <p className="text-sm text-muted-foreground">
            Build an automation from a saved workflow, review its inputs and stop conditions, then
            add a schedule or event trigger.
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !access.canSavePipelines}
            onClick={() => nav.open({ newPipeline: true })}
          >
            Build an automation
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {error}
        </p>
      ) : null}
      {notes.map((note) => (
        <p key={note} className="text-sm text-muted-foreground">
          {note}
        </p>
      ))}
      {drafts.length ? (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-medium">Choose a snippet to review</h3>
          {drafts.map((entry) => (
            <div
              key={entry.draft.id}
              className="flex items-start justify-between gap-4 rounded-lg border border-border p-4"
            >
              <div className="min-w-0">
                <p className="font-medium">{entry.draft.name}</p>
                <p className="text-sm text-muted-foreground">
                  {entry.draft.description || entry.draft.instructions.slice(0, 160)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {entry.intent === "edits"
                    ? "Requests changes"
                    : entry.intent === "planning"
                      ? "Ideas and planning"
                      : "Review permissions"}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => onDraft(entry)}>
                Review draft
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
