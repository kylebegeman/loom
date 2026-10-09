import { useState, type ReactNode } from "react";
import { useAtomValue } from "@effect/atom-react";
import { ChevronRightIcon, FolderIcon, PlayIcon } from "lucide-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { DEVICE_QA_FLOWS_DIR, type DeviceQaFlow } from "@t3tools/contracts/fork";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { useComposerDraftStore } from "~/composerDraftStore";
import { cn } from "~/lib/utils";
import type { DeviceQaOption } from "./devices";
import { Alert, Meta, Muted, failureOf, useAction, valueOf } from "./parts";
import { recordPrompt, recordPromptProblem } from "./recordPrompt";
import { deviceQa } from "./state";

/** Folder → flows, root first, folders in name order. */
function groupByFolder(flows: ReadonlyArray<DeviceQaFlow>) {
  const groups = new Map<string, Array<DeviceQaFlow>>();
  for (const flow of flows) groups.set(flow.folder, [...(groups.get(flow.folder) ?? []), flow]);
  return [...groups.entries()].sort(([a], [b]) =>
    a === "" ? -1 : b === "" ? 1 : a.localeCompare(b),
  );
}

/** A folder runs its e2e flows and those of nested folders, like the agent tool. */
export const folderPaths = (flows: ReadonlyArray<DeviceQaFlow>, folder: string) =>
  flows
    .filter(
      (flow) =>
        flow.kind === "e2e" && (flow.folder === folder || flow.folder.startsWith(`${folder}/`)),
    )
    .map((flow) => flow.path);

const PLATFORM_LABEL: Record<string, string> = { ios: "iOS", android: "Android" };

function FlowYaml({ threadRef, path }: { threadRef: ScopedThreadRef; path: string }) {
  const result = useAtomValue(
    deviceQa.flowText({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, path },
    }),
  );
  const failure = failureOf(result);
  if (failure) return <Alert>{failure}</Alert>;
  const text = valueOf(result)?.text;
  if (text === undefined) return <Muted>Loading...</Muted>;
  return (
    <pre className="max-h-80 overflow-auto rounded-md border bg-background px-3 py-2.5 font-mono text-2xs leading-relaxed">
      {text}
    </pre>
  );
}

function FlowFacts({ flow }: { flow: DeviceQaFlow }) {
  if (flow.kind === "invalid")
    return (
      <span className="break-words text-destructive-foreground text-xs">{flow.parseError}</span>
    );
  return (
    <Meta
      items={[
        `${flow.stepCount} ${flow.stepCount === 1 ? "step" : "steps"}`,
        flow.snapshotSteps > 0 &&
          `${flow.snapshotSteps} ${flow.snapshotSteps === 1 ? "snapshot" : "snapshots"}`,
        flow.platforms.length > 0 &&
          flow.platforms.map((platform) => PLATFORM_LABEL[platform] ?? platform).join(", "),
        flow.prerequisite && `Needs ${flow.prerequisite}`,
      ]}
    />
  );
}

function FlowRow({
  threadRef,
  flow,
  canRun,
  onRun,
}: {
  threadRef: ScopedThreadRef;
  flow: DeviceQaFlow;
  canRun: boolean;
  onRun: (paths: ReadonlyArray<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="flex flex-col">
      <div className="flex min-w-0 items-center gap-2 pr-2.5 hover:bg-accent/40">
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? `Hide ${flow.name}` : `Show ${flow.name}`}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 py-2.5 pl-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          onClick={() => setOpen(!open)}
        >
          <ChevronRightIcon
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
              open && "rotate-90",
            )}
          />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate font-medium text-sm">{flow.name}</span>
            <FlowFacts flow={flow} />
          </span>
        </button>
        {flow.kind === "fragment" && <Badge variant="secondary">Fragment</Badge>}
        {flow.kind === "invalid" && <Badge variant="error">Invalid</Badge>}
        {flow.kind === "e2e" && (
          <Button
            size="xs"
            variant="outline"
            aria-label={`Run ${flow.name}`}
            disabled={!canRun}
            onClick={() => onRun([flow.path])}
          >
            <PlayIcon />
            Run
          </Button>
        )}
      </div>
      {open && (
        <div className="flex flex-col gap-2 border-t bg-muted/40 px-3 py-3">
          {flow.firstEcho && <Muted>Starts at: {flow.firstEcho}</Muted>}
          <FlowYaml threadRef={threadRef} path={flow.path} />
        </div>
      )}
    </li>
  );
}

export function FlowList({
  threadRef,
  flows,
  truncated,
  canRun,
  onRun,
}: {
  threadRef: ScopedThreadRef;
  flows: ReadonlyArray<DeviceQaFlow>;
  truncated: boolean;
  canRun: boolean;
  onRun: (paths: ReadonlyArray<string>) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {groupByFolder(flows).map(([folder, entries]) => {
        const paths = folderPaths(flows, folder);
        return (
          <div key={folder} className="flex flex-col gap-1.5">
            <div className="flex min-h-6 items-center justify-between gap-2">
              <h3 className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
                <FolderIcon aria-hidden className="size-3.5 shrink-0" />
                <span className="truncate font-mono">
                  {folder === "" ? DEVICE_QA_FLOWS_DIR : `${DEVICE_QA_FLOWS_DIR}/${folder}`}
                </span>
              </h3>
              {folder !== "" && paths.length > 1 && (
                <Button size="xs" variant="ghost" disabled={!canRun} onClick={() => onRun(paths)}>
                  <PlayIcon />
                  Run folder
                </Button>
              )}
            </div>
            <ul className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card">
              {entries.map((flow) => (
                <FlowRow
                  key={flow.path}
                  threadRef={threadRef}
                  flow={flow}
                  canRun={canRun}
                  onRun={onRun}
                />
              ))}
            </ul>
          </div>
        );
      })}
      {truncated && <Muted>Only the first flows are listed; the folder has more.</Muted>}
    </div>
  );
}

/** Names a flow and describes the path; the agent records it with argent's tools. */
export function RecordWithAgent({
  threadRef,
  device,
  onDone,
}: {
  threadRef: ScopedThreadRef;
  device: DeviceQaOption | null;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [description, setDescription] = useState("");
  const record = useAction();
  const problem =
    recordPromptProblem({ name: name.trim(), folder }) ??
    (description.trim() === "" ? "Describe the path through the app." : null) ??
    (device === null ? "Choose a device first." : null);

  const submit = () =>
    void record.act(async () => {
      if (problem !== null || device === null) throw new Error(problem ?? "Choose a device first.");
      const text = recordPrompt({
        name: name.trim(),
        folder,
        description,
        device: {
          name: device.name,
          platform: device.target.platform,
          deviceId: device.target.deviceId,
        },
      });
      const store = useComposerDraftStore.getState();
      const prompt = store.getComposerDraft(threadRef)?.prompt ?? "";
      store.setPrompt(threadRef, prompt.trim() === "" ? text : `${prompt.trimEnd()}\n\n${text}`);
      onDone();
    });

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-col gap-0.5">
        <h3 className="font-medium text-sm">Record a new flow</h3>
        <Muted>
          The prompt goes into the composer. Send it and the agent records the flow with argent on{" "}
          {device?.name ?? "the chosen device"}.
        </Muted>
      </div>
      <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-2">
        <Field label="Name">
          <Input
            size="sm"
            placeholder="checkout"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Folder" hint="Optional">
          <Input
            size="sm"
            placeholder="payments"
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
          />
        </Field>
      </div>
      <Field label="Path through the app">
        <Textarea
          placeholder="Open the cart, pay with the saved card, check the receipt."
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button size="sm" type="submit" disabled={problem !== null}>
          Put prompt in composer
        </Button>
        {problem !== null && (name !== "" || description !== "") && (
          <span className="text-muted-foreground text-xs">{problem}</span>
        )}
      </div>
      {record.error && <Alert>{record.error}</Alert>}
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="flex items-baseline gap-1.5 font-medium text-xs">
        {label}
        {hint && <span className="font-normal text-muted-foreground">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
