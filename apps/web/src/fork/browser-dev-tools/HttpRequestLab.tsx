import ApiWorkspaces from "./ApiWorkspaces";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type {
  DevHttpExchange,
  DevHttpMethod,
  DevHttpRequest,
  DevHttpSummary,
} from "@t3tools/contracts/fork";
import { Input } from "~/components/ui/input";
import { Clock3Icon, SendIcon, FlaskConicalIcon, Trash2Icon, RefreshCwIcon } from "lucide-react";
import HttpResponse from "./HttpResponse";
import { LabSelect, LabTabs, LabCodeEditor, MethodBadge } from "./HttpLabParts";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import {
  AlertDialog,
  AlertDialogPopup,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "~/components/ui/alert-dialog";
import { randomUUID } from "~/lib/utils";
import { devEnvironment as dev, runDevCommand, attachDevEvidence } from "./state";
const methods = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
function parseHeaders(text: string) {
  const headers: Record<string, string> = {};
  for (const line of text.split("\n").filter((line) => line.trim())) {
    const colon = line.indexOf(":");
    if (colon < 1) throw new Error("Enter each header as Name: value on its own line.");
    const name = line.slice(0, colon).trim().toLowerCase();
    if (headers[name] !== undefined) throw new Error("Enter each header name once.");
    headers[name] = line.slice(colon + 1).trim();
  }
  return headers;
}
export default function HttpRequestLab({
  threadRef,
  serverUrl,
  supportsApi = false,
  supportsEditing = false,
}: {
  threadRef: ScopedThreadRef;
  serverUrl?: string | undefined;
  supportsApi?: boolean | undefined;
  supportsEditing?: boolean | undefined;
}) {
  const id = useId();
  const [mode, setMode] = useState<"saved" | "scratch">(supportsApi ? "saved" : "scratch");
  const canUse = useAtomValue(dev.httpSend.permissionAtom(threadRef.environmentId));
  const [selected, setSelected] = useState<DevHttpExchange | null>(null);
  const [historyEntries, setHistoryEntries] = useState<readonly DevHttpSummary[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyPending, setHistoryPending] = useState(canUse);
  const historyRevision = useRef(0);
  const refreshHistory = useCallback(
    (signal?: AbortSignal, exchangeId?: string) => {
      if (!canUse) return Promise.resolve();
      const revision = ++historyRevision.current;
      const current = () => !signal?.aborted && revision === historyRevision.current;
      return runDevCommand(dev.httpHistory, {
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, ...(exchangeId ? { exchangeId } : {}) },
      }).then(
        (result) => {
          if (current()) {
            setHistoryEntries(result.exchanges);
            if (exchangeId) {
              setSelected(result.selected);
            }
            setHistoryError(
              exchangeId && !result.selected
                ? "This exchange was cleared or expired from history."
                : null,
            );
            setHistoryPending(false);
          }
        },
        (error: unknown) => {
          if (current()) {
            setHistoryError(
              error instanceof Error ? error.message : "Request history is unavailable.",
            );
            setHistoryPending(false);
          }
        },
      );
    },
    [canUse, threadRef.environmentId, threadRef.threadId],
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads protected history through its guarded RPC and discards results after this panel unmounts
  useEffect(() => {
    const controller = new AbortController();
    void refreshHistory(controller.signal);
    return () => controller.abort();
  }, [refreshHistory]);
  const [method, setMethod] = useState<DevHttpMethod>("GET");
  const [url, setUrl] = useState(serverUrl ?? "");
  const [headers, setHeaders] = useState("");
  const [body, setBody] = useState("");
  const [bodyEncoding, setBodyEncoding] = useState<"text" | "base64">("text");
  const [timeout, setTimeoutSeconds] = useState("30");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [requestTab, setRequestTab] = useState<"headers" | "body" | "settings">("headers");
  const [checks, setChecks] = useState<readonly { name: string; passed: boolean }[]>([]);
  const pending = useRef<{ key: string; requestId: string } | null>(null);
  const send = async () => {
    if (busy || !canUse) return;
    setError(null);
    const timeoutMs = Number(timeout) * 1000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) {
      setError("Set a timeout between 0.1 and 60 seconds.");
      return;
    }
    let parsedHeaders: Record<string, string>;
    try {
      parsedHeaders = parseHeaders(headers);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Check the request fields.");
      return;
    }
    const request: DevHttpRequest = {
      method,
      url: url.trim(),
      headers: parsedHeaders,
      body,
      ...(bodyEncoding === "base64" ? { bodyEncoding } : {}),
      timeoutMs,
    };
    const key = JSON.stringify(request);
    if (pending.current?.key !== key) pending.current = { key, requestId: randomUUID() };
    setBusy(true);
    setNote(null);
    try {
      const exchange = await runDevCommand(dev.httpSend, {
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, requestId: pending.current.requestId, request },
      });
      setSelected(exchange);
      setChecks([]);
      pending.current = null;
      void refreshHistory();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "The request result is unavailable. Retrying unchanged fields uses the same request ID.",
      );
    }
    setBusy(false);
  };
  const load = (exchange: DevHttpExchange) => {
    setMode("scratch");
    const request = exchange.request;
    setMethod(request.method);
    const restoredUrl = new URL(request.url);
    let redacted = Object.values(request.headers).includes("[redacted]");
    for (const name of new Set(restoredUrl.searchParams.keys())) {
      if (restoredUrl.searchParams.get(name) === "[redacted]") {
        restoredUrl.searchParams.delete(name);
        redacted = true;
      }
    }
    setUrl(restoredUrl.toString());
    setBody(request.body);
    setBodyEncoding(request.bodyEncoding ?? "text");
    setTimeoutSeconds(String(request.timeoutMs / 1000));
    setHeaders(
      Object.entries(request.headers)
        .filter(([, value]) => value !== "[redacted]")
        .map(([name, value]) => `${name}: ${value}`)
        .join("\n"),
    );
    setNote(
      redacted
        ? "Loaded saved fields. Authentication values were redacted; restore them before sending if needed."
        : "Loaded saved fields. Send runs a new request.",
    );
    pending.current = null;
    setError(null);
  };
  const clear = async () => {
    setConfirmClear(false);
    setBusy(true);
    setError(null);
    try {
      await runDevCommand(dev.httpClear, {
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId },
      });
      setSelected(null);
      setHistoryEntries([]);
      void refreshHistory();
    } catch (error) {
      setError(error instanceof Error ? error.message : "History could not be cleared.");
    }
    setBusy(false);
  };
  const evidence = selected
    ? `${selected.request.method} ${selected.request.url}\n${selected.error ? `Error: ${selected.error}` : `HTTP ${selected.status}`} · ${selected.durationMs} ms\n\nResponse headers:\n${JSON.stringify(selected.headers, null, 2)}\n\n${selected.binary ? `[Binary response, ${selected.byteLength} bytes captured]` : selected.body.slice(0, 16000)}${selected.truncated ? "\n[Response preview truncated]" : ""}${selected.body.length > 16000 ? "\n[Draft excerpt limited to 16000 characters]" : ""}`
    : "";
  const response = (
    <HttpResponse
      exchange={canUse ? selected : null}
      checks={checks}
      busy={busy}
      onLoad={load}
      onAttach={() =>
        attachDevEvidence(threadRef, `HTTP exchange:\n\n\`\`\`text\n${evidence}\n\`\`\``)
      }
    />
  );
  return (
    <div
      className="@container min-w-0"
      onKeyDown={(event) => {
        if (
          mode === "scratch" &&
          !event.defaultPrevented &&
          (event.metaKey || event.ctrlKey) &&
          event.key === "Enter"
        ) {
          event.preventDefault();
          void send();
        }
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <FlaskConicalIcon className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Pulse</h2>
        </div>
        <div className="flex items-center gap-1">
          {supportsApi ? (
            <>
              <Button
                size="sm"
                variant={mode === "saved" ? "secondary" : "ghost"}
                disabled={busy}
                onClick={() => setMode("saved")}
              >
                Collections
              </Button>
              <Button
                size="sm"
                variant={mode === "scratch" ? "secondary" : "ghost"}
                disabled={busy}
                onClick={() => setMode("scratch")}
              >
                Scratch request
              </Button>
            </>
          ) : null}
          <Button
            size="icon-sm"
            variant={showHistory ? "secondary" : "ghost"}
            aria-label="Request history"
            aria-expanded={showHistory}
            onClick={() => setShowHistory(!showHistory)}
          >
            <Clock3Icon />
          </Button>
        </div>
      </div>
      {!canUse ? (
        <p role="status" className="p-4 text-sm">
          Execution access is required to send requests or read history.
        </p>
      ) : null}
      {showHistory && canUse ? (
        <section
          aria-label="HTTP history"
          className="space-y-3 border-b border-border bg-muted/15 p-4"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-medium">Request history</h3>
            <div className="flex gap-1">
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Refresh history"
                onClick={() => {
                  setHistoryPending(true);
                  void refreshHistory();
                }}
                disabled={busy || !canUse}
              >
                <RefreshCwIcon />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Clear history"
                disabled={busy || !canUse || !historyEntries?.length}
                onClick={() => setConfirmClear(true)}
              >
                <Trash2Icon />
              </Button>
            </div>
          </div>
          <p className="text-2xs leading-5 text-muted-foreground">
            Latest 50 exchanges for this checkout. Credentials are redacted.
          </p>
          {historyPending && !historyEntries ? (
            <p role="status" className="text-xs">
              Loading history...
            </p>
          ) : null}
          {historyEntries?.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">No requests yet.</p>
          ) : null}
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {historyEntries?.map((exchange) => (
              <button
                key={exchange.id}
                type="button"
                disabled={busy}
                onClick={() => {
                  setChecks([]);
                  void refreshHistory(undefined, exchange.id);
                }}
                className={cn(
                  "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  selected?.id === exchange.id && "bg-accent",
                )}
              >
                <MethodBadge method={exchange.request.method} />
                <span className="min-w-0 flex-1 truncate font-mono text-2xs">
                  {exchange.request.url}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {exchange.status ?? exchange.error}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {supportsApi && mode === "saved" ? (
        <ApiWorkspaces
          threadRef={threadRef}
          supportsEditing={supportsEditing}
          onBusy={setBusy}
          onSelectResponse={(exchangeId) => {
            setSelected(null);
            setChecks([]);
            if (exchangeId) void refreshHistory(undefined, exchangeId);
          }}
          response={response}
          onResult={(result) => {
            setSelected(result.exchange);
            setChecks(result.checks);
            void refreshHistory();
          }}
        />
      ) : (
        <>
          <form
            className="flex flex-wrap items-center gap-2 p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <div className="w-28">
              <LabSelect
                label="HTTP method"
                compact
                value={method}
                options={methods.map((value) => ({ value, label: value }))}
                disabled={busy}
                onChange={(value) => {
                  setMethod(value as DevHttpMethod);
                  if (["GET", "HEAD"].includes(value)) setBody("");
                }}
              />
            </div>
            <div className="min-w-0 flex-1 basis-44">
              <Input
                aria-label="Request URL"
                type="url"
                font="mono"
                value={url}
                placeholder="http://localhost:3000/api"
                onChange={(event) => setUrl(event.target.value)}
                disabled={busy}
                required
              />
            </div>
            <Button type="submit" size="sm" disabled={busy || !canUse}>
              <SendIcon />
              {busy ? "Sending..." : "Send"}
            </Button>
          </form>
          {serverUrl ? (
            <div className="px-4 pb-2">
              <Button size="xs" variant="ghost" disabled={busy} onClick={() => setUrl(serverUrl)}>
                Use running server
              </Button>
            </div>
          ) : null}
          <LabTabs
            label="Scratch request settings"
            value={requestTab}
            onChange={setRequestTab}
            items={[
              { value: "headers", label: "Headers" },
              { value: "body", label: "Body" },
              { value: "settings", label: "Settings" },
            ]}
          >
            {requestTab === "headers" ? (
              <LabCodeEditor
                label="Request headers"
                value={headers}
                onChange={setHeaders}
                disabled={busy}
                placeholder="Content-Type: application/json"
              />
            ) : null}
            {requestTab === "body" ? (
              !["GET", "HEAD"].includes(method) ? (
                <>
                  <div className="max-w-xs p-3">
                    <LabSelect
                      label="Body encoding"
                      value={bodyEncoding}
                      options={[
                        { value: "text", label: "Text or JSON" },
                        { value: "base64", label: "Binary as base64" },
                      ]}
                      disabled={busy}
                      onChange={(value) => setBodyEncoding(value === "base64" ? "base64" : "text")}
                    />
                  </div>
                  <LabCodeEditor
                    label="Request body"
                    value={body}
                    onChange={setBody}
                    disabled={busy}
                    placeholder="Request body"
                  />
                </>
              ) : (
                <p className="px-4 py-8 text-xs text-muted-foreground">
                  GET and HEAD requests do not send a body.
                </p>
              )
            ) : null}
            {requestTab === "settings" ? (
              <div className="max-w-xs space-y-2 p-4">
                <label htmlFor={`${id}-timeout`} className="text-xs">
                  Timeout in seconds
                </label>
                <Input
                  id={`${id}-timeout`}
                  type="number"
                  min="0.1"
                  max="60"
                  step="0.1"
                  value={timeout}
                  onChange={(event) => setTimeoutSeconds(event.target.value)}
                  disabled={busy}
                />
              </div>
            ) : null}
          </LabTabs>
          {response}
        </>
      )}
      {error || historyError ? (
        <p role="alert" className="m-3 rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
          {error ?? historyError}
        </p>
      ) : null}
      {note ? (
        <p role="status" className="px-4 py-2 text-xs text-muted-foreground">
          {note}
        </p>
      ) : null}
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2 text-3xs text-muted-foreground">
        <span>Runs on this checkout's computer · Redirects stay visible</span>
        <span>⌘ / Ctrl + Enter to send</span>
      </footer>
      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear request history?</AlertDialogTitle>
            <AlertDialogDescription>
              This clears response previews for every conversation sharing this checkout. Request
              receipts remain to prevent duplicate sends.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setConfirmClear(false)}>
              Keep history
            </Button>
            <Button variant="destructive" onClick={() => void clear()}>
              Clear history
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}
