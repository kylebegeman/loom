import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { useServerConfigs } from "~/state/entities";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type {
  DevApiDetails,
  DevApiEnvironment,
  DevApiRunResult,
  DevApiSource,
  DevApiWorkspace,
} from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { Menu, MenuTrigger, MenuPopup, MenuItem } from "~/components/ui/menu";
import * as Schema from "effect/Schema";
import {
  VaultError,
  DevApiDetails as DetailsSchema,
  DevApiSource as SourceSchema,
} from "@t3tools/contracts/fork";
import { toastManager } from "~/components/ui/toast";
import { Input } from "~/components/ui/input";
import {
  ChevronRightIcon,
  FolderIcon,
  SearchIcon,
  PlusIcon,
  DownloadIcon,
  Trash2Icon,
  SaveIcon,
  SendIcon,
  SlidersHorizontalIcon,
  Undo2Icon,
  BracesIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";
import ApiLibraryPanel from "./ApiLibraryPanel";
import ApiWorkflowPanel from "./ApiWorkflowPanel";
import ApiAuthoring from "./ApiAuthoring";
import VariableInspector from "./VariableInspector";
import ApiRequestEditor from "./ApiRequestEditor";
import ApiEnvironmentEditor from "./ApiEnvironmentEditor";
import { LabSelect, MethodBadge } from "./HttpLabParts";
import { draftObject, draftText, draftRows, readMultipartFiles } from "./apiRequestDraft";
import { cn } from "~/lib/utils";
import { randomUUID } from "~/lib/utils";
import { devEnvironment as dev, runDevCommand } from "./state";
const isVaultError = Schema.is(VaultError);
const problem = (e: unknown) =>
  e instanceof Error ? e.message : "The API workspace is unavailable.";
type Request = DevApiDetails["requests"][number];
const TabSnapshot = Schema.Struct({
  details: DetailsSchema,
  draft: Schema.String,
  source: SourceSchema,
  exchangeId: Schema.NullOr(Schema.String),
});
type TabSnapshot = typeof TabSnapshot.Type;
const Session = Schema.Struct({ active: Schema.String, tabs: Schema.Array(TabSnapshot) });
const decodeSession = Schema.decodeUnknownSync(Schema.fromJsonString(Session));
function recoverSession(key: string): typeof Session.Type {
  try {
    return decodeSession(localStorage.getItem(key) ?? '{"active":"","tabs":[]}');
  } catch {
    return { active: "", tabs: [] };
  }
}

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
  const [open, setOpen] = useState(level <= 1);
  const groups = new Map<string, Request[]>();
  const requests: Request[] = [];
  for (const entry of entries) {
    const key = entry.folders[level];
    if (key === undefined) requests.push(entry);
    else groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-2 text-left text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <ChevronRightIcon className={cn("size-3 shrink-0", open && "rotate-90")} />
        <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <span className="text-3xs tabular-nums text-muted-foreground">{entries.length}</span>
      </button>
      {open ? (
        <div className="min-w-0 pl-2">
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
            <button
              key={entry.id}
              type="button"
              disabled={disabled}
              aria-current={selected === entry.id ? "true" : undefined}
              onClick={() => onSelect(entry.id)}
              className={cn(
                "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50",
                selected === entry.id && "bg-accent",
              )}
            >
              <MethodBadge method={entry.method} />
              <span className="truncate">{entry.name}</span>
            </button>
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
  onSelectResponse,
  response,
  supportsEditing = false,
}: {
  threadRef: ScopedThreadRef;
  onResult: (result: DevApiRunResult) => void;
  response: ReactNode;
  onSelectResponse: (exchangeId: string | null) => void;
  supportsEditing?: boolean;
  onBusy: (busy: boolean) => void;
}) {
  const id = useId();
  const storageKey = `loom:pulse:tabs:${threadRef.environmentId}:${threadRef.threadId}`;
  const [recovered] = useState(() => recoverSession(storageKey));
  const initialTab = recovered.tabs.find(
    (t) =>
      `${t.details.workspace.id}:${t.details.selected?.id}` === recovered.active ||
      t.details.selected?.id === recovered.active,
  );
  const [tabs, setTabs] = useState<readonly TabSnapshot[]>(recovered.tabs);
  const [exchangeId, setExchangeId] = useState<string | null>(initialTab?.exchangeId ?? null);
  const supportsPulse = supportsLoomFeature(
    useServerConfigs().get(threadRef.environmentId)?.environment.capabilities,
    "pulse-workbench",
  );
  const supportsMultipart = supportsLoomFeature(
    useServerConfigs().get(threadRef.environmentId)?.environment.capabilities,
    "browser-dev-tools-api-multipart",
  );
  const [multipartFiles, setMultipartFiles] = useState<Readonly<Record<number, readonly File[]>>>(
    {},
  );
  const canUse = useAtomValue(dev.apiList.permissionAtom(threadRef.environmentId));
  const [workspaces, setWorkspaces] = useState<readonly DevApiWorkspace[] | null>(null);
  const [details, setDetails] = useState<DevApiDetails | null>(initialTab?.details ?? null);
  const [source, setSource] = useState<DevApiSource>(initialTab?.source ?? { kind: "none" });
  const [environment, setEnvironment] = useState<DevApiEnvironment | null>(null);
  const [busy, setBusy] = useState(Boolean(initialTab));
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [dirty, setDirty] = useState(false);
  const [bodyBase64, setBodyBase64] = useState<string | undefined>();
  const [bodyFileName, setBodyFileName] = useState("");
  const [draft, setDraft] = useState(initialTab?.draft ?? "");
  const [editorGeneration, setEditorGeneration] = useState(0);
  const [showEnvironment, setShowEnvironment] = useState(false);
  const [showCollections, setShowCollections] = useState(true);
  const [showImport, setShowImport] = useState(false);
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
  const finishRecovery = useEffectEvent((value: DevApiDetails, env: DevApiEnvironment) => {
    if (initialTab && value.selected?.sourceJson === initialTab.details.selected?.sourceJson)
      setDetails(value);
    setEnvironment(env);
    setBusy(false);
    onBusy(false);
    onSelectResponse(initialTab?.exchangeId ?? null);
  });
  const failRecovery = useEffectEvent((e: unknown) => {
    setError(problem(e));
    setBusy(false);
    onBusy(false);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- restores server metadata and the selected environment for a locally recovered request
  useEffect(() => {
    if (!initialTab || !canUse) return;
    const controller = new AbortController();
    const input = { threadId: threadRef.threadId, workspaceId: initialTab.details.workspace.id };
    void Promise.all([
      runDevCommand(dev.apiRead, {
        environmentId: threadRef.environmentId,
        input: {
          ...input,
          ...(initialTab.details.selected ? { requestKey: initialTab.details.selected.id } : {}),
        },
      }),
      runDevCommand(dev.apiEnvironment, {
        environmentId: threadRef.environmentId,
        input: { ...input, source: initialTab.source },
      }),
    ]).then(
      ([value, env]) => {
        if (!controller.signal.aborted) finishRecovery(value, env);
      },
      (e: unknown) => {
        if (!controller.signal.aborted) failRecovery(e);
      },
    );
    return () => controller.abort();
  }, [initialTab, canUse, threadRef.environmentId, threadRef.threadId]);
  const activeSnapshot = details?.selected ? { details, draft, source, exchangeId } : null;
  const sameTab = (tab: TabSnapshot) =>
    tab.details.workspace.id === activeSnapshot?.details.workspace.id &&
    tab.details.selected?.id === activeSnapshot?.details.selected?.id;
  const openTabs = activeSnapshot
    ? tabs.some(sameTab)
      ? tabs.map((tab) => (sameTab(tab) ? activeSnapshot : tab))
      : [...tabs, activeSnapshot]
    : tabs;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- persists recoverable request drafts to this client's local storage
  useEffect(() => {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          active: details?.selected ? `${details.workspace.id}:${details.selected.id}` : "",
          tabs: openTabs.map((tab) => ({
            ...tab,
            details: {
              ...tab.details,
              requests: tab.details.requests.filter((r) => r.id === tab.details.selected?.id),
            },
          })),
        }),
      );
    } catch {
      toastManager.add({
        id: "pulse-recovery-storage",
        type: "error",
        title: "Draft recovery storage is unavailable",
        description: "Keep this panel open until your requests are saved.",
      });
    }
  }, [storageKey, details, openTabs]);
  const remember = () => setTabs(openTabs);
  const activateTab = async (tab: TabSnapshot) => {
    remember();
    setDetails(tab.details);
    setDraft(tab.draft);
    setSource(tab.source);
    setExchangeId(tab.exchangeId);
    onSelectResponse(tab.exchangeId);
    setMultipartFiles({});
    setBodyBase64(undefined);
    setBodyFileName("");
    setEnvironment(null);
    setDirty(false);
    setEditorGeneration((n) => n + 1);
    pending.current = null;
    working(true);
    try {
      const [env, latest] = await Promise.all([
        runDevCommand(dev.apiEnvironment, {
          ...target,
          input: { ...target.input, workspaceId: tab.details.workspace.id, source: tab.source },
        }),
        runDevCommand(dev.apiRead, {
          ...target,
          input: {
            ...target.input,
            workspaceId: tab.details.workspace.id,
            ...(tab.details.selected ? { requestKey: tab.details.selected.id } : {}),
          },
        }),
      ]);
      if (latest.selected?.sourceJson === tab.details.selected?.sourceJson) setDetails(latest);
      setEnvironment(env);
      setError(null);
    } catch (e) {
      setError(problem(e));
    }
    working(false);
  };
  const closeTab = (tab: TabSnapshot) => {
    const remaining = openTabs.filter((t) => t !== tab);
    if (
      tab.draft !== tab.details.selected?.sourceJson &&
      !window.confirm("Discard this tab's unsaved request edits?")
    )
      return;
    setTabs(remaining);
    if (
      tab.details.selected?.id === details?.selected?.id &&
      tab.details.workspace.id === details?.workspace.id
    ) {
      setDetails(null);
      setDraft("");
      setEnvironment(null);
      onSelectResponse(null);
      if (remaining.length) void activateTabAfterClose(remaining);
    }
  };
  const activateTabAfterClose = async (remaining: readonly TabSnapshot[]) => {
    await activateTab(remaining[remaining.length - 1]!);
    setTabs(remaining);
  };
  const working = (value: boolean) => {
    setBusy(value);
    onBusy(value);
  };
  const chooseWorkspace = async (workspaceId: string) => {
    remember();
    const revision = ++generation.current;
    setMultipartFiles({});
    setBodyBase64(undefined);
    setBodyFileName("");
    setDetails(null);
    setEnvironment(null);
    setDirty(false);
    setSource({ kind: "none" });
    setError(null);
    setDraft("");
    setNote(null);
    pending.current = null;
    if (!workspaceId) return;
    working(true);
    try {
      const value = await runDevCommand(dev.apiRead, {
        ...target,
        input: { ...target.input, workspaceId },
      });
      if (revision === generation.current) {
        setDetails(value);
        setDraft(value.selected?.sourceJson ?? "");
        setExchangeId(null);
        onSelectResponse(null);
      }
    } catch (e) {
      if (revision === generation.current) setError(problem(e));
    }
    working(false);
  };
  const chooseRequest = async (requestKey: string) => {
    if (!details) return;
    const existing = openTabs.find(
      (t) =>
        t.details.workspace.id === details.workspace.id && t.details.selected?.id === requestKey,
    );
    if (existing) {
      await activateTab(existing);
      return;
    }
    remember();
    const revision = ++generation.current;
    setMultipartFiles({});
    setBodyBase64(undefined);
    setBodyFileName("");
    working(true);
    setError(null);
    setDraft("");
    pending.current = null;
    try {
      const value = await runDevCommand(dev.apiRead, {
        ...target,
        input: { ...target.input, workspaceId: details.workspace.id, requestKey },
      });
      if (revision === generation.current) {
        setDetails(value);
        setDraft(value.selected?.sourceJson ?? "");
        setExchangeId(null);
        onSelectResponse(null);
      }
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
        setDraft("");
        setShowImport(false);
        setDraft("");
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
    if (!details?.selected || !environment || busy || dirty || missingMultipartFiles) return;
    working(true);
    setError(null);
    setNote(null);
    try {
      const input = {
        ...target.input,
        workspaceId: details.workspace.id,
        requestKey: details.selected.id,
        source,
        expectedRevision: details.revision,
        environmentRevision: environment.revision,
        ...(draftObject(sourceDraft.body).contentType === "multipart/form-data"
          ? {
              uploads: await readMultipartFiles(
                Object.fromEntries(
                  Object.entries(multipartFiles).filter(([index]) => {
                    const field = draftRows(draftObject(sourceDraft.body).body)[Number(index)];
                    return (
                      field?.active !== false && field?.isFile === true && draftText(field.key)
                    );
                  }),
                ),
              ),
            }
          : {}),
        ...(bodyBase64 === undefined ? {} : { bodyBase64 }),
        ...(supportsEditing && draft !== details.selected.sourceJson
          ? { requestOverride: draft }
          : {}),
      };
      const key = JSON.stringify(input);
      if (pending.current?.key !== key) pending.current = { key, requestId: randomUUID() };
      const value = await runDevCommand(dev.apiRun, {
        ...target,
        input: { ...input, requestId: pending.current.requestId },
      });
      onResult(value);
      setExchangeId(value.exchange.id);
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
      if (isVaultError(e)) pending.current = null;
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
      setMultipartFiles({});
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
  const sourceDraft = draft ? draftObject(JSON.parse(draft)) : {};
  const requestDirty = Boolean(details?.selected && draft && draft !== details.selected.sourceJson);
  const matches =
    details?.requests.filter((r) =>
      `${r.method} ${r.name} ${r.folders.join(" ")}`.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  const sourceValue =
    !environment && source.kind === "none"
      ? "choose"
      : source.kind === "json"
        ? `j:${source.id}`
        : source.kind === "dotenv"
          ? `d:${source.path}`
          : "";
  const saveRequest = async () => {
    if (!details?.selected || !draft) return;
    working(true);
    setError(null);
    try {
      const value = await runDevCommand(dev.apiSaveRequest, {
        ...target,
        input: {
          ...target.input,
          workspaceId: details.workspace.id,
          requestKey: details.selected.id,
          expectedRevision: details.revision,
          sourceJson: draft,
        },
      });
      setDetails(value);
      setDraft(value.selected?.sourceJson ?? "");
      setNote("Request saved. Your imported original is preserved.");
      pending.current = null;
    } catch (e) {
      setError(problem(e));
    }
    working(false);
  };
  const exportWorkspace = async () => {
    if (!details) return;
    working(true);
    setError(null);
    try {
      const value = await runDevCommand(dev.apiExport, {
        ...target,
        input: { ...target.input, workspaceId: details.workspace.id },
      });
      for (const file of value.files) {
        const url = URL.createObjectURL(new Blob([file.content], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = file.name;
        link.click();
        URL.revokeObjectURL(url);
      }
      setNote("Exported native JSON files. Secret values and Vault references are excluded.");
    } catch (e) {
      setError(problem(e));
    }
    working(false);
  };
  const upload = async (file: File | undefined) => {
    const revision = ++generation.current;
    setMultipartFiles({});
    setBodyBase64(undefined);
    setBodyFileName("");
    if (!file) return;
    if (file.size > 131072) {
      setError("Choose a binary file up to 128 KiB.");
      return;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (generation.current !== revision) return;
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      setBodyBase64(btoa(binary));
      setBodyFileName(file.name);
      setError(null);
    } catch {
      if (generation.current === revision) setError("The upload file could not be read.");
    }
  };
  let suggestedOrigin = "";
  try {
    const values = Object.fromEntries(
      environment?.variables.filter((v) => !v.vault).map((v) => [v.key, v.value]) ?? [],
    );
    suggestedOrigin = new URL(
      draftText(sourceDraft.endpoint).replace(
        /<<([^<>]+)>>/g,
        (match, key: string) => values[key] ?? match,
      ),
    ).origin;
  } catch {
    /* The binding editor asks for an origin when templates cannot resolve yet. */
  }
  const bodyType = draftObject(sourceDraft.body).contentType;
  const missingMultipartFiles =
    bodyType === "multipart/form-data" &&
    (!supportsMultipart ||
      draftRows(draftObject(sourceDraft.body).body).some(
        (field, index) =>
          field.active !== false &&
          draftText(field.key) &&
          field.isFile === true &&
          !multipartFiles[index]?.length,
      ));
  if (!canUse)
    return (
      <p role="status" className="p-5 text-sm">
        Execution access is required to open API workspaces and environments.
      </p>
    );
  return (
    <section
      aria-label="API workspaces"
      className="@container min-w-0"
      onKeyDown={(event) => {
        if (!event.defaultPrevented && (event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          void send();
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={showCollections ? "Hide collections" : "Show collections"}
          aria-expanded={showCollections}
          onClick={() => setShowCollections(!showCollections)}
        >
          {showCollections ? <PanelLeftCloseIcon /> : <PanelLeftOpenIcon />}
        </Button>
        <div className="min-w-0 flex-1 basis-40">
          <LabSelect
            label="API workspace"
            value={details?.workspace.id ?? ""}
            disabled={busy || dirty || requestDirty}
            onChange={(value) => {
              setSearch("");
              void chooseWorkspace(value);
            }}
            options={[
              { value: "", label: "Choose a workspace" },
              ...(workspaces ?? []).map((w) => ({
                value: w.id,
                label: `${w.name} (${w.requestCount})`,
              })),
            ]}
          />
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => setShowImport(!showImport)}
        >
          <PlusIcon />
          Import
        </Button>
        {details ? (
          <Menu>
            <MenuTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Workspace actions"
                  disabled={busy}
                />
              }
            >
              <MoreHorizontalIcon />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem
                disabled={dirty || requestDirty}
                onClick={() => void chooseWorkspace(details.workspace.id)}
              >
                <RefreshCwIcon />
                Reload workspace
              </MenuItem>
              {supportsEditing ? (
                <MenuItem disabled={dirty || requestDirty} onClick={() => void exportWorkspace()}>
                  <DownloadIcon />
                  Export workspace
                </MenuItem>
              ) : null}
              <MenuItem onClick={() => setConfirmRemove(true)}>
                <Trash2Icon />
                Remove workspace
              </MenuItem>
            </MenuPopup>
          </Menu>
        ) : null}
      </div>
      {supportsPulse ? (
        <ApiAuthoring
          threadRef={threadRef}
          details={details}
          disabled={busy || dirty}
          onUpdated={(value) => {
            remember();
            setDetails(value);
            setDraft(value.selected?.sourceJson ?? "");
            setEditorGeneration((n) => n + 1);
            setMultipartFiles({});
            setBodyBase64(undefined);
            setExchangeId(null);
            onSelectResponse(null);
            if (!details || details.workspace.id !== value.workspace.id) {
              setSource({ kind: "none" });
              setEnvironment(null);
            }
            void refresh();
          }}
        />
      ) : null}
      {supportsPulse && details ? (
        <ApiWorkflowPanel
          key={details.workspace.id}
          threadRef={threadRef}
          details={details}
          source={source}
          disabled={busy || dirty || requestDirty}
          canRun={Boolean(environment)}
          onRevision={(revision) => setDetails({ ...details, revision })}
          onInspect={(result) => {
            onResult(result);
            setExchangeId(result.exchange.id);
          }}
        />
      ) : null}
      {supportsPulse ? (
        <ApiLibraryPanel
          key={details?.workspace.id ?? "project"}
          threadRef={threadRef}
          details={details}
          disabled={busy || dirty || requestDirty}
          onUpdated={(value) => {
            remember();
            setDetails(value);
            setDraft(value.selected?.sourceJson ?? "");
            setEnvironment(null);
            setSource({ kind: "none" });
            setEditorGeneration((n) => n + 1);
            setMultipartFiles({});
            setBodyBase64(undefined);
            setExchangeId(null);
            onSelectResponse(null);
            void refresh();
          }}
        />
      ) : null}
      {showImport ? (
        <div className="space-y-3 border-b border-border bg-muted/20 p-4">
          <h3 className="text-sm font-medium">Import a Hoppscotch workspace</h3>
          <p className="text-xs leading-5 text-muted-foreground">
            Choose its collection and environment JSON files together. Each workspace keeps its own
            folders, scripts and variables.
          </p>
          <label className="block space-y-1.5 text-xs">
            <span>Workspace name</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              placeholder="AspectAvy"
            />
          </label>
          <label className="block space-y-2 text-xs">
            <span>Hoppscotch JSON files</span>
            <Input
              type="file"
              accept=".json,application/json"
              multiple
              disabled={busy || !name.trim()}
              onChange={(e) => {
                void importFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      ) : null}
      {openTabs.length ? (
        <div
          aria-label="Open requests"
          className="flex gap-1 overflow-x-auto border-b border-border p-2"
        >
          {openTabs.map((tab) => (
            <div
              key={`${tab.details.workspace.id}:${tab.details.selected?.id}`}
              className="flex shrink-0 items-center rounded-md bg-muted/40"
            >
              <Button
                size="sm"
                variant={tab.details.selected?.id === details?.selected?.id ? "secondary" : "ghost"}
                disabled={busy || dirty}
                onClick={() => void activateTab(tab)}
              >
                {tab.details.requests.find((r) => r.id === tab.details.selected?.id)?.name ??
                  "Request"}
                {tab.draft !== tab.details.selected?.sourceJson ? " *" : ""}
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Close ${tab.details.requests.find((r) => r.id === tab.details.selected?.id)?.name ?? "request"}`}
                disabled={busy || dirty}
                onClick={() => closeTab(tab)}
              >
                <XIcon />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
      {initialTab && !environment && !busy ? (
        <div className="p-3">
          <Button size="sm" variant="outline" onClick={() => void activateTab(initialTab)}>
            Resume recovered request
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            Drafts were recovered. Upload files must be selected again.
          </p>
        </div>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="m-3 rounded-lg bg-destructive/10 p-3 text-xs leading-5 text-destructive"
        >
          {error}
        </p>
      ) : null}
      {note ? (
        <p role="status" className="px-4 py-2 text-xs leading-5 text-muted-foreground">
          {note}
        </p>
      ) : null}
      {details ? (
        <div
          className={cn(
            "grid min-w-0 grid-cols-[minmax(0,1fr)]",
            showCollections && "@min-[760px]:grid-cols-[224px_minmax(0,1fr)]",
          )}
        >
          {showCollections ? (
            <aside
              aria-label="Collections"
              className="min-w-0 border-b border-border bg-muted/15 @min-[760px]:border-r @min-[760px]:border-b-0"
            >
              <div className="flex items-center justify-between px-4 pt-4">
                <h3 className="text-xs font-medium">Collections</h3>
                <span className="text-2xs tabular-nums text-muted-foreground">
                  {details.workspace.requestCount}
                </span>
              </div>
              <div className="p-3">
                <Input
                  aria-label="Find an endpoint"
                  type="search"
                  placeholder="Find an endpoint..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="max-h-60 min-w-0 overflow-y-auto px-2 pb-3 @min-[760px]:max-h-[800px]">
                {search ? (
                  matches.slice(0, 100).map((entry) => (
                    <button
                      type="button"
                      key={entry.id}
                      disabled={busy || dirty}
                      onClick={() => void chooseRequest(entry.id)}
                      aria-current={selected?.id === entry.id ? "true" : undefined}
                      className={cn(
                        "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50",
                        selected?.id === entry.id && "bg-accent",
                      )}
                    >
                      <MethodBadge method={entry.method} />
                      <span className="min-w-0">
                        <span className="block truncate">{entry.name}</span>
                        <span className="block truncate text-3xs text-muted-foreground">
                          {entry.folders.join(" / ")}
                        </span>
                      </span>
                    </button>
                  ))
                ) : (
                  <Folder
                    name={details.workspace.name}
                    entries={details.requests}
                    level={
                      details.requests.length &&
                      details.requests.every((r) => r.folders[0] === details.workspace.name)
                        ? 1
                        : 0
                    }
                    selected={selected?.id}
                    disabled={busy || dirty}
                    onSelect={(key) => void chooseRequest(key)}
                  />
                )}
                {!search
                  ? details.folders
                      ?.filter(
                        (folder) =>
                          !details.requests.some(
                            (r) => JSON.stringify(r.folders) === JSON.stringify(folder),
                          ),
                      )
                      .map((folder) => (
                        <p
                          key={folder.join("/")}
                          className="flex gap-2 px-4 py-2 text-xs text-muted-foreground"
                        >
                          <FolderIcon className="size-3.5" />
                          {folder.join(" / ")} (empty)
                        </p>
                      ))
                  : null}
                {search && matches.length === 0 ? (
                  <p className="p-4 text-center text-xs text-muted-foreground">
                    No endpoints match your search.
                  </p>
                ) : null}
                {matches.length > 100 && search ? (
                  <p className="p-2 text-2xs text-muted-foreground">
                    100 of {matches.length} results. Refine your search.
                  </p>
                ) : null}
              </div>
            </aside>
          ) : null}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/10 px-4 py-3">
              <SlidersHorizontalIcon className="size-3.5 text-muted-foreground" />
              <div className="min-w-0 flex-1 basis-44">
                <LabSelect
                  label="Variable source"
                  value={sourceValue}
                  disabled={busy || dirty}
                  onChange={(value) => void chooseSource(value)}
                  options={[
                    { value: "choose", label: "Select environment" },
                    { value: "", label: "No environment" },
                    ...details.environments.map((e) => ({
                      value: `j:${e.id}`,
                      label: `JSON · ${e.name}`,
                    })),
                    ...details.dotenvFiles.map((path) => ({
                      value: `d:${path}`,
                      label: `Project · ${path}`,
                    })),
                  ]}
                />
              </div>
              <Button
                size="sm"
                variant={showEnvironment ? "secondary" : "ghost"}
                disabled={busy || !environment}
                onClick={() => setShowEnvironment(!showEnvironment)}
              >
                <BracesIcon />
                Variables{environment ? ` (${environment.variables.length})` : ""}
                {dirty ? " *" : ""}
              </Button>
            </div>
            {showEnvironment && environment ? (
              <ApiEnvironmentEditor
                key={JSON.stringify(source)}
                threadRef={threadRef}
                source={source}
                environment={environment}
                dirty={dirty}
                disabled={busy}
                suggestedOrigin={suggestedOrigin}
                vaultEnabled={supportsEditing}
                onChange={(variables) => {
                  setEnvironment({ ...environment, variables });
                  setDirty(true);
                  pending.current = null;
                }}
                onSave={() => void save()}
                onReset={() => void chooseSource(sourceValue)}
              />
            ) : null}
            {details.selected && draft ? (
              <>
                <div className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-2xs text-muted-foreground">
                        {selected?.folders.join(" / ")}
                      </p>
                      <div className="mt-1">
                        <Input
                          aria-label="Request name"
                          value={draftText(sourceDraft.name)}
                          disabled={busy || !supportsEditing}
                          onChange={(e) =>
                            setDraft(JSON.stringify({ ...sourceDraft, name: e.target.value }))
                          }
                        />
                      </div>
                    </div>
                    {supportsEditing ? (
                      <div className="flex gap-1">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Discard request edits"
                          disabled={busy || !requestDirty}
                          onClick={() => {
                            setDraft(details.selected!.sourceJson);
                            setEditorGeneration(editorGeneration + 1);
                            setMultipartFiles({});
                          }}
                        >
                          <Undo2Icon />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy || !requestDirty}
                          onClick={() => void saveRequest()}
                        >
                          <SaveIcon />
                          Save
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  <form
                    className="flex flex-wrap items-center gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void send();
                    }}
                  >
                    <div className="w-28">
                      <LabSelect
                        label="Request method"
                        compact
                        value={draftText(sourceDraft.method)}
                        options={["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map(
                          (value) => ({ value, label: value }),
                        )}
                        disabled={busy || !supportsEditing}
                        onChange={(value) =>
                          setDraft(JSON.stringify({ ...sourceDraft, method: value }))
                        }
                      />
                    </div>
                    <div className="min-w-0 flex-1 basis-44">
                      <Input
                        aria-label="Request URL"
                        font="mono"
                        value={draftText(sourceDraft.endpoint)}
                        disabled={busy || !supportsEditing}
                        onChange={(e) =>
                          setDraft(JSON.stringify({ ...sourceDraft, endpoint: e.target.value }))
                        }
                        placeholder="<<baseUrl>>/api"
                      />
                    </div>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={
                        busy ||
                        !environment ||
                        dirty ||
                        (bodyType === "application/octet-stream" && bodyBase64 === undefined) ||
                        missingMultipartFiles
                      }
                    >
                      <SendIcon />
                      {busy ? "Working..." : "Send"}
                    </Button>
                  </form>
                  {missingMultipartFiles && environment && !dirty ? (
                    <p role="status" className="text-xs text-muted-foreground">
                      {supportsMultipart
                        ? "Choose files for every active file field in Body before sending."
                        : "Update this request's computer to send multipart forms."}
                    </p>
                  ) : null}
                  {dirty ? (
                    <p className="text-xs text-warning-foreground">
                      Save or discard variable edits before sending.
                    </p>
                  ) : !environment ? (
                    <p className="text-xs text-muted-foreground">
                      Select an environment above, or explicitly choose No environment.
                    </p>
                  ) : requestDirty ? (
                    <p className="text-xs text-muted-foreground">
                      Unsaved request. Send tests these edits; Save keeps them in the collection.
                    </p>
                  ) : null}
                </div>
                <VariableInspector
                  request={sourceDraft}
                  inherited={details.selected.variables ?? []}
                  environment={environment?.variables ?? []}
                  source={
                    source.kind === "json"
                      ? (details.environments.find((e) => e.id === source.id)?.name ??
                        "Environment")
                      : source.kind === "dotenv"
                        ? source.path
                        : "No environment"
                  }
                  disabled={busy}
                  onEditEnvironment={(key) => {
                    if (source.kind === "none") {
                      setDraft(
                        JSON.stringify({
                          ...sourceDraft,
                          requestVariables: [
                            ...draftRows(sourceDraft.requestVariables),
                            {
                              key,
                              value: "",
                              currentValue: "",
                              secret: /token|password|secret|key/i.test(key),
                            },
                          ],
                        }),
                      );
                      return;
                    }
                    if (!environment) {
                      setError("Select an environment before defining this variable.");
                      return;
                    }
                    if (!environment.variables.some((v) => v.key === key)) {
                      setEnvironment({
                        ...environment,
                        variables: [
                          ...environment.variables,
                          { key, value: "", secret: /token|password|secret|key/i.test(key) },
                        ],
                      });
                      setDirty(true);
                    }
                    setShowEnvironment(true);
                  }}
                  onEditRequest={(key, value) => {
                    const rows = draftRows(sourceDraft.requestVariables);
                    setDraft(
                      JSON.stringify({
                        ...sourceDraft,
                        requestVariables: rows.some((r) => r.key === key)
                          ? rows.map((r) =>
                              r.key === key ? { ...r, value, currentValue: value } : r,
                            )
                          : [
                              ...rows,
                              {
                                key,
                                value,
                                currentValue: value,
                                secret: /token|password|secret|key/i.test(key),
                              },
                            ],
                      }),
                    );
                  }}
                />
                {typeof sourceDraft.loomImportWarning === "string" ? (
                  <p role="status" className="px-4 py-2 text-xs text-warning-foreground">
                    {sourceDraft.loomImportWarning}
                  </p>
                ) : null}
                {supportsEditing ? (
                  <ApiRequestEditor
                    key={`${details.selected.id}:${details.revision}:${editorGeneration}`}
                    selected={details.selected}
                    draft={draft}
                    onChange={setDraft}
                    disabled={busy}
                    bodyFileName={bodyFileName}
                    onUpload={(file) => void upload(file)}
                    supportsMultipart={supportsMultipart}
                    multipartFiles={multipartFiles}
                    onMultipartFiles={(index, files) =>
                      setMultipartFiles((current) => ({ ...current, [index]: files }))
                    }
                    onResetMultipartFiles={() => setMultipartFiles({})}
                    onRemoveMultipartField={(index) =>
                      setMultipartFiles((current) =>
                        Object.fromEntries(
                          Object.entries(current)
                            .filter(([key]) => Number(key) !== index)
                            .map(([key, files]) => [
                              Number(key) > index ? Number(key) - 1 : Number(key),
                              files,
                            ]),
                        ),
                      )
                    }
                  />
                ) : (
                  <details className="px-4 pb-4 text-xs">
                    <summary>Imported request</summary>
                    <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-all">
                      {JSON.stringify(sourceDraft, null, 2)}
                    </pre>
                  </details>
                )}
              </>
            ) : (
              <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-center">
                <div className="rounded-xl bg-muted p-3">
                  <SearchIcon className="size-6 text-muted-foreground" />
                </div>
                <h3 className="text-sm font-medium">Find your next request</h3>
                <p className="max-w-xs text-xs leading-5 text-muted-foreground">
                  Browse a collection or search by name, folder or method. Select an environment,
                  then send.
                </p>
              </div>
            )}
            {response}
          </div>
        </div>
      ) : (
        <div className="flex min-h-80 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
          <div className="rounded-xl bg-muted p-4">
            <BracesIcon className="size-7 text-muted-foreground" />
          </div>
          <h3 className="text-base font-medium">Your APIs, in your workspace</h3>
          <p className="max-w-sm text-sm leading-6 text-muted-foreground">
            Create a workspace, paste cURL, import OpenAPI, or bring Hoppscotch collections into
            Loom. Browse endpoints, use project variables and inspect every response.
          </p>
          <Button size="sm" onClick={() => setShowImport(true)}>
            <PlusIcon />
            Import a workspace
          </Button>
          {!workspaces ? (
            <p role="status" className="text-xs text-muted-foreground">
              Loading workspaces...
            </p>
          ) : workspaces.length ? (
            <p className="text-xs text-muted-foreground">
              Choose one of your {workspaces.length} workspaces above.
            </p>
          ) : null}
        </div>
      )}
      {confirmRemove ? (
        <div
          role="alertdialog"
          aria-modal="false"
          aria-labelledby={`${id}-remove`}
          className="m-3 space-y-3 rounded-lg border border-border bg-muted p-4"
        >
          <h3 id={`${id}-remove`} className="text-sm font-medium">
            Remove {details?.workspace.name}?
          </h3>
          <p className="text-xs leading-5 text-muted-foreground">
            This removes Loom's imported copy and saved variables. Original files and HTTP history
            remain.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => void remove()}>
              Remove workspace
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setConfirmRemove(false)}
            >
              Keep workspace
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
