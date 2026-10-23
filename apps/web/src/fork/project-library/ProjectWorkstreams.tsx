import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import type {
  LibraryProject,
  LibraryWorkstream,
  LibraryWorkstreamReference,
  LibraryWorkingCopy,
  LibraryThreadSummary,
} from "@t3tools/contracts/fork";
import { GitBranchIcon, PlusIcon, CheckCircleIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { randomUUID } from "~/lib/utils";
import { projectLibrary, useLibraryPermission } from "./state";
import { LibraryErrorNotice } from "./LibraryControls";

export function ProjectWorkstreams({
  project,
  authorityId,
  copies,
  threads,
}: {
  readonly project: LibraryProject;
  readonly authorityId: EnvironmentId;
  readonly copies: readonly LibraryWorkingCopy[];
  readonly threads: readonly LibraryThreadSummary[];
}) {
  const query = useEnvironmentQuery(
    projectLibrary.workstreams({ environmentId: authorityId, input: { projectId: project.id } }),
  );
  const allowed = useLibraryPermission(projectLibrary.saveWorkstream, authorityId);
  const save = useAtomCommand(projectLibrary.saveWorkstream, { reportFailure: false });
  const [editing, setEditing] = useState<LibraryWorkstream | "new" | null>(null);
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [references, setReferences] = useState<readonly LibraryWorkstreamReference[]>([]);
  const [referenceKind, setReferenceKind] =
    useState<LibraryWorkstreamReference["kind"]>("verification");
  const [referenceText, setReferenceText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const draftId = useRef("");
  const pendingSave = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const edit = (value: LibraryWorkstream | "new") => {
    setEditing(value);
    setTitle(value === "new" ? "" : value.title);
    setGoal(value === "new" ? "" : value.goal);
    setReferences(value === "new" ? [] : value.references);
    setError(null);
    draftId.current = value === "new" ? randomUUID() : value.id;
    pendingSave.current = null;
  };
  const persist = async (state: LibraryWorkstream["state"]) => {
    if (!editing || busy || !title.trim()) return;
    setBusy(true);
    setError(null);
    const input = {
      id: draftId.current,
      projectId: project.id,
      expectedRevision: editing === "new" ? 0 : editing.revision,
      title: title.trim(),
      goal,
      references,
      state,
    };
    const fingerprint = JSON.stringify(input);
    if (pendingSave.current?.fingerprint !== fingerprint)
      pendingSave.current = { fingerprint, requestId: randomUUID() };
    const result = await save({
      environmentId: authorityId,
      input: { ...input, requestId: pendingSave.current.requestId },
    });
    if (result._tag === "Success") {
      setEditing(null);
      query.refresh();
    } else {
      const cause = squashAtomCommandFailure(result);
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save. Refresh and review linked work before completing.",
      );
    }
    setBusy(false);
  };
  const options: LibraryWorkstreamReference[] = [
    ...threads
      .filter((thread) => !thread.deleted)
      .map((thread) => ({
        kind: "thread" as const,
        id: thread.threadId,
        environmentId: thread.environmentId,
        label: thread.title,
        state: thread.settled ? ("completed" as const) : ("open" as const),
      })),
    ...copies.map((copy) => ({
      kind: "copy" as const,
      id: copy.id,
      environmentId: copy.environmentId,
      label: copy.rootPath.slice(-160),
      state: "open" as const,
    })),
    ...project.resources
      .filter((resource) => resource.kind !== "link")
      .map((resource) => ({
        kind: "repository" as const,
        id: resource.id,
        label: resource.title,
        state: "open" as const,
      })),
  ];
  const add = (reference: LibraryWorkstreamReference) =>
    setReferences((previous) =>
      previous.some(
        (item) =>
          item.kind === reference.kind &&
          item.id === reference.id &&
          item.environmentId === reference.environmentId,
      )
        ? previous
        : [...previous, reference],
    );
  return (
    <section aria-label="Workstreams" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Workstreams</h2>
        <Button
          size="xs"
          variant="ghost"
          disabled={!allowed || busy || editing !== null}
          onClick={() => edit("new")}
        >
          <PlusIcon />
          New workstream
        </Button>
      </div>
      <p className="max-w-2xl text-sm text-muted-foreground">
        Keep conversations, branches and checks together around a goal. Optional for everyday work.
      </p>
      <LibraryErrorNotice error={query.error ?? error} onRetry={query.refresh} />
      {query.isPending ? (
        <p className="text-sm text-muted-foreground">Loading workstreams...</p>
      ) : null}
      {!query.isPending && !query.error && !query.data?.length && !editing ? (
        <p className="text-sm text-muted-foreground">
          No workstreams yet. Start a conversation as usual, or group a larger piece of work here.
        </p>
      ) : null}
      {query.data?.map((stream) => (
        <div key={stream.id} className="flex items-start gap-3 py-2">
          <GitBranchIcon className="mt-1 size-4 shrink-0 text-(--project-plum)" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {stream.title}{" "}
              <span className="text-xs font-normal text-muted-foreground">{stream.state}</span>
            </p>
            {stream.goal ? (
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{stream.goal}</p>
            ) : null}
            <ul className="mt-2 space-y-1 text-sm">
              {stream.references.map((ref) => (
                <li
                  key={`${ref.kind}:${ref.environmentId ?? ""}:${ref.id}`}
                  className="flex items-center gap-2"
                >
                  {ref.state === "completed" || ref.state === "passed" ? (
                    <CheckCircleIcon className="size-3 text-(--project-green)" />
                  ) : (
                    <span className="size-1.5 rounded-full bg-(--project-gold)" />
                  )}
                  {ref.kind === "thread" ? (
                    <Link
                      to="/library/conversations/$conversationId"
                      params={{
                        conversationId:
                          threads.find(
                            (thread) =>
                              (thread.threadId === ref.id || thread.id === ref.id) &&
                              (!ref.environmentId || thread.environmentId === ref.environmentId),
                          )?.id ?? ref.id,
                      }}
                    >
                      {ref.label}
                    </Link>
                  ) : ref.url ? (
                    <a href={ref.url} target="_blank" rel="noreferrer">
                      {ref.label}
                    </a>
                  ) : (
                    <span>{ref.label}</span>
                  )}
                  <span className="text-xs text-muted-foreground">{ref.state}</span>
                </li>
              ))}
            </ul>
          </div>
          <Button
            size="xs"
            variant="ghost"
            disabled={!allowed || busy || editing !== null}
            onClick={() => edit(stream)}
          >
            Review
          </Button>
        </div>
      ))}
      {editing ? (
        <form
          className="space-y-3 rounded-xl border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void persist("active");
          }}
        >
          <Input
            autoFocus
            aria-label="Workstream title"
            placeholder="What are we working toward?"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={160}
            disabled={busy}
          />
          <Textarea
            aria-label="Workstream goal"
            placeholder="Outcome and completion criteria"
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            maxLength={8192}
            disabled={busy}
          />
          <label className="grid gap-1 text-sm">
            Link existing work
            <select
              aria-label="Link existing work"
              disabled={busy}
              value=""
              onChange={(event) => {
                if (event.target.value === "") return;
                const option = options[Number(event.target.value)];
                if (option) add(option);
              }}
            >
              <option value="">Choose a conversation, copy or repository</option>
              {options.map((option, index) => (
                <option
                  key={`${option.kind}:${option.environmentId ?? ""}:${option.id}`}
                  value={index}
                >
                  {option.kind}: {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="New reference type"
              disabled={busy}
              value={referenceKind}
              onChange={(event) => {
                const kind = ["branch", "pull-request", "verification"] as const;
                setReferenceKind(
                  kind.find((value) => value === event.target.value) ?? "verification",
                );
              }}
            >
              <option value="verification">Check</option>
              <option value="branch">Branch</option>
              <option value="pull-request">Pull request URL</option>
            </select>
            <Input
              aria-label="Reference name or URL"
              placeholder="Check name, branch or PR URL"
              value={referenceText}
              onChange={(event) => setReferenceText(event.target.value)}
              maxLength={160}
            />
            <Button
              size="xs"
              type="button"
              variant="outline"
              disabled={busy || !referenceText.trim()}
              onClick={() => {
                const text = referenceText.trim();
                add({
                  kind: referenceKind,
                  id: randomUUID(),
                  label: text,
                  ...(referenceKind === "pull-request" ? { url: text } : {}),
                  state: "open",
                });
                setReferenceText("");
              }}
            >
              Add
            </Button>
          </div>
          {references.map((ref, index) => (
            <div
              key={`${ref.kind}:${ref.environmentId ?? ""}:${ref.id}`}
              className="flex items-center gap-2 text-sm"
            >
              <span className="min-w-0 flex-1 truncate">{ref.label}</span>
              <select
                aria-label={`State of ${ref.label}`}
                disabled={busy}
                value={ref.state}
                onChange={(event) => {
                  const state = ["open", "passed", "completed", "blocked"] as const;
                  const value = state.find((entry) => entry === event.target.value);
                  if (value)
                    setReferences((previous) =>
                      previous.map((entry, position) =>
                        position === index ? { ...entry, state: value } : entry,
                      ),
                    );
                }}
              >
                {["open", "passed", "completed", "blocked"].map((state) => (
                  <option key={state}>{state}</option>
                ))}
              </select>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  setReferences((previous) => previous.filter((_, position) => position !== index))
                }
              >
                Unlink
              </Button>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Check results and PR completion are recorded by you or your agent. Completion rechecks
            linked local work and refuses unfinished items.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" type="submit" disabled={!allowed || busy || !title.trim()}>
              {editing !== "new" && editing.state !== "active"
                ? "Reopen workstream"
                : "Save active"}
            </Button>
            <Button
              size="sm"
              type="button"
              variant="outline"
              disabled={!allowed || busy || !title.trim()}
              onClick={() => void persist("completed")}
            >
              Complete
            </Button>
            {editing !== "new" ? (
              <Button
                size="sm"
                type="button"
                variant="ghost"
                disabled={!allowed || busy}
                onClick={() => void persist("archived")}
              >
                Archive
              </Button>
            ) : null}
            <Button
              size="sm"
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => setEditing(null)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
