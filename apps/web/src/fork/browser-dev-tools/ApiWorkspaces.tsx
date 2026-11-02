import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type {
  DevApiDetails,
  DevApiEnvironment,
  DevApiRunResult,
  DevApiSource,
  DevApiWorkspace,
  DevHttpExchange,
} from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { randomUUID } from "~/lib/utils";
import { devEnvironment as dev, runDevCommand } from "./state";
const problem = (e: unknown) =>
  e instanceof Error ? e.message : "The API workspace is unavailable.";
const selectClass = "w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-xs";
type Request = DevApiDetails["requests"][number];
function Folder({
  name,
  entries,
  level,
  selected,
  disabled,
  onSelect,
}: {
  name: string;
  entries: readonly Request[];
  level: number;
  selected: string | undefined;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const groups = new Map<string, Request[]>();
  const requests: Request[] = [];
  for (const entry of entries) {
    const key = entry.folders[level];
    if (key === undefined) requests.push(entry);
    else groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return (
    <div className="min-w-0 space-y-1">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="truncate">
          {open ? "▾" : "▸"} {name} ({entries.length})
        </span>
      </Button>
      {open ? (
        <div className="min-w-0 space-y-1 pl-3">
          {[...groups].map(([key, value]) => (
            <Folder
              key={key}
              name={key}
              entries={value}
              level={level + 1}
              selected={selected}
              disabled={disabled}
              onSelect={onSelect}
            />
          ))}
          {requests.map((entry) => (
            <div className="grid grid-cols-[minmax(0,1fr)]" key={entry.id}>
              <Button
                size="sm"
                type="button"
                variant={selected === entry.id ? "secondary" : "ghost"}
                disabled={disabled}
                onClick={() => onSelect(entry.id)}
              >
                <span className="truncate">
                  {entry.method} {entry.name}
                </span>
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
export default function ApiWorkspaces({
  threadRef,
  onResult,
  onBusy,
}: {
  threadRef: ScopedThreadRef;
  onResult: (exchange: DevHttpExchange) => void;
  onBusy: (busy: boolean) => void;
}) {
  const id = useId();
  const canUse = useAtomValue(dev.apiList.permissionAtom(threadRef.environmentId));
  const [workspaces, setWorkspaces] = useState<readonly DevApiWorkspace[] | null>(null);
  const [details, setDetails] = useState<DevApiDetails | null>(null);
  const [source, setSource] = useState<DevApiSource>({ kind: "none" });
  const [environment, setEnvironment] = useState<DevApiEnvironment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [variableSearch, setVariableSearch] = useState("");
  const [newKey, setNewKey] = useState("");
  const [dirty, setDirty] = useState(false);
  const [bodyBase64, setBodyBase64] = useState<string | undefined>();
  const [bodyFileName, setBodyFileName] = useState("");
  const [result, setResult] = useState<DevApiRunResult | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const generation = useRef(0);
  const pending = useRef<{ key: string; requestId: string } | null>(null);
  const target = {
    environmentId: threadRef.environmentId,
    input: { threadId: threadRef.threadId },
  };
  const refresh = useCallback(
    (signal?: AbortSignal) => {
      if (!canUse) return Promise.resolve();
      return runDevCommand(dev.apiList, {
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId },
      }).then(
        (value) => {
          if (!signal?.aborted) setWorkspaces(value);
        },
        (e: unknown) => {
          if (!signal?.aborted) setError(problem(e));
        },
      );
    },
    [canUse, threadRef.environmentId, threadRef.threadId],
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads protected workspace metadata and cancels results when the selected computer or access changes
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => {
      controller.abort();
      generation.current++;
    };
  }, [refresh]);
  const working = (value: boolean) => {
    setBusy(value);
    onBusy(value);
  };
  const chooseWorkspace = async (workspaceId: string) => {
    const revision = ++generation.current;
    setBodyBase64(undefined);
    setBodyFileName("");
    setDetails(null);
    setEnvironment(null);
    setDirty(false);
    setSource({ kind: "none" });
    setError(null);
    setResult(null);
    setNote(null);
    pending.current = null;
    if (!workspaceId) return;
    working(true);
    try {
      const value = await runDevCommand(dev.apiRead, {
        ...target,
        input: { ...target.input, workspaceId },
      });
      if (revision === generation.current) setDetails(value);
    } catch (e) {
      if (revision === generation.current) setError(problem(e));
    }
    working(false);
  };
  const chooseRequest = async (requestKey: string) => {
    if (!details) return;
    const revision = ++generation.current;
    setBodyBase64(undefined);
    setBodyFileName("");
    working(true);
    setError(null);
    setResult(null);
    pending.current = null;
    try {
      const value = await runDevCommand(dev.apiRead, {
        ...target,
        input: { ...target.input, workspaceId: details.workspace.id, requestKey },
      });
      if (revision === generation.current) setDetails(value);
    } catch (e) {
      if (revision === generation.current) setError(problem(e));
    }
    working(false);
  };
  const chooseSource = async (value: string) => {
    if (!details) return;
    const next: DevApiSource = value.startsWith("j:")
      ? { kind: "json", id: value.slice(2) }
      : value.startsWith("d:")
        ? { kind: "dotenv", path: value.slice(2) }
        : { kind: "none" };
    const revision = ++generation.current;
    setSource(next);
    setEnvironment(null);
    setDirty(false);
    setError(null);
    setNote(null);
    pending.current = null;
    working(true);
    try {
      const env = await runDevCommand(dev.apiEnvironment, {
        ...target,
        input: { ...target.input, workspaceId: details.workspace.id, source: next },
      });
      if (revision === generation.current) setEnvironment(env);
    } catch (e) {
      if (revision === generation.current) setError(problem(e));
    }
    working(false);
  };
  const importFiles = async (files: FileList | null) => {
    if (!files?.length || !name.trim()) return;
    working(true);
    setError(null);
    try {
      const selected = Array.from(files);
      if (
        selected.some((f) => f.size > 16777216) ||
        selected.reduce((n, f) => n + f.size, 0) > 67108864
      ) {
        setError("Choose JSON files up to 16 MiB each and 64 MiB in total.");
      } else {
        const values = await Promise.all(
          selected.map(async (file) => ({ name: file.name, content: await file.text() })),
        );
        const value = await runDevCommand(dev.apiImport, {
          ...target,
          input: { ...target.input, name: name.trim(), files: values },
        });
        setDetails(value);
        setEnvironment(null);
        setDirty(false);
        setSource({ kind: "none" });
        setResult(null);
        setNote("Workspace imported. Choose an endpoint and select its environment explicitly.");
        pending.current = null;
        await refresh();
      }
    } catch (e) {
      setError(problem(e));
    }
    working(false);
  };
  const save = async () => {
    if (!details || !environment) return;
    working(true);
    setError(null);
    try {
      const value = await runDevCommand(dev.apiSaveEnvironment, {
        ...target,
        input: {
          ...target.input,
          workspaceId: details.workspace.id,
          source,
          expectedRevision: environment.revision,
          variables: environment.variables,
        },
      });
      setEnvironment(value);
      setDirty(false);
      setNote(source.kind === "dotenv" ? "Saved to the selected .env file." : "Environment saved.");
      pending.current = null;
    } catch (e) {
      setError(problem(e));
    }
    working(false);
  };
  const send = async () => {
    if (!details?.selected || !environment || busy || dirty) return;
    const input = {
      ...target.input,
      workspaceId: details.workspace.id,
      requestKey: details.selected.id,
      source,
      expectedRevision: details.revision,
      environmentRevision: environment.revision,
      ...(bodyBase64 === undefined ? {} : { bodyBase64 }),
    };
    const key = JSON.stringify(input);
    if (pending.current?.key !== key) pending.current = { key, requestId: randomUUID() };
    working(true);
    setError(null);
    setNote(null);
    try {
      const value = await runDevCommand(dev.apiRun, {
        ...target,
        input: { ...input, requestId: pending.current.requestId },
      });
      setResult(value);
      onResult(value.exchange);
      pending.current = null;
      const env = await runDevCommand(dev.apiEnvironment, {
        ...target,
        input: { ...target.input, workspaceId: details.workspace.id, source },
      });
      setEnvironment(env);
      setNote(
        !value.environmentUpdated && source.kind !== "none"
          ? "The response is available. The environment changed during this request; its latest values were preserved."
          : source.kind === "dotenv"
            ? "Script captures are saved as request variables for this file. Save to the .env file when you want them written there."
            : value.environmentUpdated
              ? "Script captures were saved to the selected environment."
              : "The response is available.",
      );
    } catch (e) {
      setError(problem(e));
    }
    working(false);
  };
  const remove = async () => {
    if (!details) return;
    working(true);
    setError(null);
    try {
      await runDevCommand(dev.apiRemove, {
        ...target,
        input: { ...target.input, workspaceId: details.workspace.id },
      });
      setBodyBase64(undefined);
      setBodyFileName("");
      setDetails(null);
      setEnvironment(null);
      setConfirmRemove(false);
      await refresh();
    } catch (e) {
      setError(problem(e));
    }
    working(false);
  };
  const selected = details?.requests.find((r) => r.id === details.selected?.id);
  const matches =
    details?.requests.filter((r) =>
      `${r.method} ${r.name} ${r.folders.join(" ")}`.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  const checkOccurrences = new Map<string, number>();
  const checkRows = (result?.checks ?? []).map((check) => {
    const occurrence = (checkOccurrences.get(check.name) ?? 0) + 1;
    checkOccurrences.set(check.name, occurrence);
    return { ...check, key: `${check.name}:${occurrence}` };
  });
  const variableMatches =
    environment?.variables.filter((v) =>
      v.key.toLowerCase().includes(variableSearch.toLowerCase()),
    ) ?? [];
  const sourceValue =
    !environment && source.kind === "none"
      ? "choose"
      : source.kind === "json"
        ? `j:${source.id}`
        : source.kind === "dotenv"
          ? `d:${source.path}`
          : "";
  if (!canUse)
    return (
      <p className="text-sm" role="status">
        Execution access is required to open API workspaces and environments.
      </p>
    );
  return (
    <section aria-label="API workspaces" className="min-w-0 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">API workspaces</h3>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void refresh()}>
          Refresh workspaces
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Import Hoppscotch collections and environments together for each workspace. Original files
        and scripts stay on this computer.
      </p>
      <details>
        <summary className="cursor-pointer text-xs font-medium">Import a workspace</summary>
        <div className="space-y-3 pt-3">
          <label className="block text-xs" htmlFor={`${id}-name`}>
            Workspace name
          </label>
          <Input
            id={`${id}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            placeholder="AspectAvy"
          />
          <label className="block text-xs" htmlFor={`${id}-files`}>
            Hoppscotch JSON files
          </label>
          <input
            id={`${id}-files`}
            className="block w-full min-w-0 text-xs"
            type="file"
            accept=".json,application/json"
            multiple
            disabled={busy || !name.trim()}
            onChange={(e) => {
              void importFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </details>
      {!workspaces && !error ? (
        <p role="status" className="text-xs">
          Reading workspaces...
        </p>
      ) : null}
      {workspaces?.length === 0 ? (
        <p className="text-xs text-muted-foreground">No imported API workspaces.</p>
      ) : null}
      <label className="block space-y-1 text-xs">
        <span>Workspace</span>
        <select
          aria-label="API workspace"
          className={selectClass}
          value={details?.workspace.id ?? ""}
          disabled={busy}
          onChange={(e) => void chooseWorkspace(e.target.value)}
        >
          <option value="">Choose a workspace</option>
          {workspaces?.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} ({w.requestCount} requests)
            </option>
          ))}
        </select>
      </label>
      {details ? (
        <>
          <label className="block space-y-1 text-xs">
            <span>Find an endpoint</span>
            <Input
              aria-label="Find an endpoint"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, folder or method"
            />
          </label>
          <div className="max-h-72 min-w-0 overflow-auto rounded-lg border border-border p-2">
            {search ? (
              matches.slice(0, 100).map((r) => (
                <div key={r.id} className="grid grid-cols-[minmax(0,1fr)]">
                  <Button
                    size="sm"
                    variant={selected?.id === r.id ? "secondary" : "ghost"}
                    disabled={busy}
                    onClick={() => void chooseRequest(r.id)}
                  >
                    <span className="truncate">
                      {r.method} {r.folders.join(" / ")} / {r.name}
                    </span>
                  </Button>
                </div>
              ))
            ) : (
              <Folder
                name="Collections"
                entries={details.requests}
                level={0}
                selected={selected?.id}
                disabled={busy}
                onSelect={(value) => void chooseRequest(value)}
              />
            )}
            {search && matches.length > 100 ? (
              <p className="text-xs text-muted-foreground">
                Showing 100 of {matches.length} endpoints. Refine the search.
              </p>
            ) : null}
            {search && !matches.length ? (
              <p className="text-xs text-muted-foreground">No matching endpoints.</p>
            ) : null}
          </div>
          <label className="block space-y-1 text-xs">
            <span>Environment source</span>
            <select
              aria-label="Environment source"
              className={selectClass}
              value={sourceValue}
              disabled={busy}
              onChange={(e) => void chooseSource(e.target.value)}
            >
              <option value="choose" disabled>
                Choose an environment source
              </option>
              <option value="">No environment</option>
              <optgroup label="Imported JSON environments">
                {details.environments.map((e) => (
                  <option key={e.id} value={`j:${e.id}`}>
                    {e.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="This checkout's dotenv files">
                {details.dotenvFiles.map((file) => (
                  <option key={file} value={`d:${file}`}>
                    {file}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          {environment && source.kind !== "none" ? (
            <details>
              <summary className="cursor-pointer text-xs font-medium">
                Variables ({environment.variables.length})
              </summary>
              <div className="space-y-3 pt-3">
                <Input
                  aria-label="Find a variable"
                  placeholder="Find a variable"
                  value={variableSearch}
                  onChange={(e) => setVariableSearch(e.target.value)}
                />
                {variableMatches.slice(0, 50).map((v) => (
                  <label className="block min-w-0 space-y-1 text-xs" key={v.key}>
                    <span className="break-all">{v.key}</span>
                    <Input
                      aria-label={`Variable ${v.key}`}
                      type={v.secret ? "password" : "text"}
                      autoComplete="off"
                      value={v.value}
                      disabled={busy}
                      onChange={(e) => {
                        setDirty(true);
                        setEnvironment({
                          ...environment,
                          variables: environment.variables.map((item) =>
                            item.key === v.key ? { ...item, value: e.target.value } : item,
                          ),
                        });
                        setNote("Save variable changes before sending.");
                      }}
                    />
                  </label>
                ))}
                {variableMatches.length > 50 ? (
                  <p className="text-xs text-muted-foreground">
                    Showing 50 variables. Search to find another key.
                  </p>
                ) : null}
                <div className="flex min-w-0 gap-2">
                  <div className="min-w-0 flex-1">
                    <Input
                      aria-label="New variable name"
                      placeholder="New variable name"
                      value={newKey}
                      onChange={(e) => setNewKey(e.target.value)}
                      disabled={busy}
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      busy ||
                      !newKey.trim() ||
                      environment.variables.some((v) => v.key === newKey.trim())
                    }
                    onClick={() => {
                      setDirty(true);
                      setEnvironment({
                        ...environment,
                        variables: [
                          ...environment.variables,
                          { key: newKey.trim(), value: "", secret: true },
                        ],
                      });
                      setVariableSearch(newKey.trim());
                      setNewKey("");
                    }}
                  >
                    Add variable
                  </Button>
                </div>
                <Button size="sm" disabled={busy} onClick={() => void save()}>
                  {source.kind === "dotenv" ? "Save to .env file" : "Save environment"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void chooseSource(sourceValue)}
                >
                  Refresh variables
                </Button>
              </div>
            </details>
          ) : null}
          {selected && details.selected ? (
            <section
              className="space-y-3 rounded-lg border border-border p-3"
              aria-label="Selected API endpoint"
            >
              <h4 className="break-words text-sm font-medium">
                {selected.method} {selected.name}
              </h4>
              <p className="break-words text-xs text-muted-foreground">
                {selected.folders.join(" / ")}
              </p>
              <p className="break-all font-mono text-2xs">{details.selected.endpoint}</p>
              {details.selected.bodyContentType === "application/octet-stream" ? (
                <label className="block space-y-1 text-xs">
                  <span>Binary upload file (up to 128 KiB)</span>
                  <input
                    type="file"
                    aria-label="Binary upload file"
                    className="block w-full min-w-0 text-xs"
                    disabled={busy}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      const revision = ++generation.current;
                      setBodyBase64(undefined);
                      setBodyFileName("");
                      setError(null);
                      if (file.size > 131072) {
                        setError("Choose an upload file up to 128 KiB.");
                        return;
                      }
                      void file.arrayBuffer().then(
                        (buffer) => {
                          if (revision !== generation.current) return;
                          setBodyBase64(
                            btoa(
                              Array.from(new Uint8Array(buffer), (byte) =>
                                String.fromCharCode(byte),
                              ).join(""),
                            ),
                          );
                          setBodyFileName(file.name);
                          pending.current = null;
                        },
                        () => {
                          if (revision === generation.current)
                            setError("The upload file could not be read.");
                        },
                      );
                    }}
                  />
                  {bodyFileName ? <span>{bodyFileName}</span> : null}
                </label>
              ) : null}
              <details>
                <summary className="cursor-pointer text-xs">Request scripts</summary>
                <p className="py-2 text-xs text-muted-foreground">
                  Scripts run on this computer when you send this endpoint. Preparation runs before
                  dispatch; response scripts capture values and report checks.
                </p>
                <h5 className="text-xs font-medium">Before request</h5>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-code p-3 text-2xs">
                  {details.selected.preScripts.join("\n\n") || "No preparation script."}
                </pre>
                <h5 className="pt-2 text-xs font-medium">After response</h5>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-code p-3 text-2xs">
                  {details.selected.testScripts.join("\n\n") || "No response script."}
                </pre>
              </details>
              <Button
                size="sm"
                disabled={
                  busy ||
                  !environment ||
                  dirty ||
                  (details.selected.bodyContentType === "application/octet-stream" &&
                    bodyBase64 === undefined)
                }
                onClick={() => void send()}
              >
                {busy ? "Working..." : "Send endpoint"}
              </Button>
            </section>
          ) : null}
          {result ? (
            <div aria-label="Request checks" className="space-y-1">
              {checkRows.map((check) => (
                <p
                  className={
                    check.passed ? "text-xs text-muted-foreground" : "text-xs text-destructive"
                  }
                  key={check.key}
                >
                  {check.passed ? "Passed" : "Failed"}: {check.name}
                </p>
              ))}
            </div>
          ) : null}
          {confirmRemove ? (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-xs">
                Remove this imported workspace and its saved variables from this computer? Your
                original files and request history are preserved.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setConfirmRemove(false)}
                >
                  Cancel
                </Button>
                <Button size="sm" disabled={busy} onClick={() => void remove()}>
                  Remove workspace
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setConfirmRemove(true)}
            >
              Remove imported workspace
            </Button>
          )}
        </>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {note ? (
        <p role="status" className="text-xs text-muted-foreground">
          {note}
        </p>
      ) : null}
    </section>
  );
}
