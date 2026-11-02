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
import { Textarea } from "~/components/ui/textarea";
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
}: {
  threadRef: ScopedThreadRef;
  serverUrl?: string | undefined;
  supportsApi?: boolean | undefined;
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
  return (
    <div className="space-y-5 p-4">
      <p className="text-xs text-muted-foreground">
        Requests run on this checkout's computer. Localhost refers to that computer. Redirect
        responses are shown without following them.
      </p>
      {!canUse ? (
        <p role="status" className="text-sm">
          Execution access is required to send requests or read their history.
        </p>
      ) : null}
      {supportsApi ? (
        <div className="flex gap-1" role="group" aria-label="HTTP request mode">
          <Button
            type="button"
            size="sm"
            variant={mode === "saved" ? "secondary" : "ghost"}
            disabled={busy}
            onClick={() => setMode("saved")}
          >
            Saved APIs
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "scratch" ? "secondary" : "ghost"}
            disabled={busy}
            onClick={() => setMode("scratch")}
          >
            One-off request
          </Button>
        </div>
      ) : null}
      {supportsApi && mode === "saved" ? (
        <ApiWorkspaces
          threadRef={threadRef}
          onBusy={setBusy}
          onResult={(exchange) => {
            setSelected(exchange);
            void refreshHistory();
          }}
        />
      ) : null}
      {!supportsApi || mode === "scratch" ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <div role="group" aria-label="HTTP method" className="flex flex-wrap gap-1">
            {methods.map((value) => (
              <Button
                type="button"
                size="sm"
                variant={method === value ? "secondary" : "ghost"}
                aria-pressed={method === value}
                key={value}
                disabled={busy}
                onClick={() => {
                  setMethod(value);
                  if (["GET", "HEAD"].includes(value)) setBody("");
                }}
              >
                {value}
              </Button>
            ))}
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-url`} className="text-xs font-medium">
              Request URL
            </label>
            <Input
              id={`${id}-url`}
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="http://localhost:3000/api"
              disabled={busy}
              required
            />
          </div>
          {serverUrl ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setUrl(serverUrl)}
            >
              Use running server
            </Button>
          ) : null}
          <div className="space-y-1">
            <label htmlFor={`${id}-headers`} className="text-xs font-medium">
              Headers
            </label>
            <Textarea
              id={`${id}-headers`}
              value={headers}
              onChange={(event) => setHeaders(event.target.value)}
              placeholder={"Content-Type: application/json"}
              disabled={busy}
            />
          </div>
          {!["GET", "HEAD"].includes(method) ? (
            <div className="space-y-1">
              <label htmlFor={`${id}-body`} className="text-xs font-medium">
                Request body
              </label>
              <label className="block space-y-1 text-xs">
                <span>Body encoding</span>
                <select
                  aria-label="Body encoding"
                  value={bodyEncoding}
                  onChange={(event) =>
                    setBodyEncoding(event.target.value === "base64" ? "base64" : "text")
                  }
                  disabled={busy}
                  className="w-full rounded-md border border-input bg-background px-3 py-2"
                >
                  <option value="text">Text or JSON</option>
                  <option value="base64">Binary as base64</option>
                </select>
              </label>
              <Textarea
                id={`${id}-body`}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="Raw text or JSON"
                disabled={busy}
              />
            </div>
          ) : null}
          <div className="space-y-1">
            <label htmlFor={`${id}-timeout`} className="text-xs font-medium">
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
          <Button type="submit" size="sm" disabled={!canUse || busy}>
            {busy ? "Working..." : "Send request"}
          </Button>
        </form>
      ) : null}
      {error || historyError ? (
        <p role="alert" className="text-sm text-destructive">
          {error ?? historyError}
        </p>
      ) : null}
      {note ? (
        <p role="status" className="text-xs text-muted-foreground">
          {note}
        </p>
      ) : null}
      {selected && canUse ? (
        <section
          aria-label="HTTP response"
          className="space-y-3 rounded-lg border border-border p-3"
        >
          <div className="flex flex-wrap justify-between gap-2">
            <h3 className="text-sm font-medium">
              {selected.error
                ? `Request ${selected.error === "timeout" ? "timed out" : "failed"}`
                : `HTTP ${selected.status}`}
            </h3>
            <span className="text-xs text-muted-foreground">
              {selected.durationMs} ms · {selected.byteLength} bytes captured
            </span>
          </div>
          <p className="break-all text-xs text-muted-foreground">
            {selected.request.method} {selected.request.url}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => load(selected)}
            >
              Load request
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                attachDevEvidence(threadRef, `HTTP exchange:\n\n\`\`\`text\n${evidence}\n\`\`\``)
              }
            >
              Add response to message
            </Button>
          </div>
          <details>
            <summary className="cursor-pointer text-xs font-medium">Response headers</summary>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-code p-3 font-mono text-2xs">
              {JSON.stringify(selected.headers, null, 2)}
            </pre>
          </details>
          {selected.binary ? (
            <p className="text-sm text-muted-foreground">
              Binary response. {selected.byteLength} bytes captured.
            </p>
          ) : (
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-code p-3 font-mono text-2xs">
              {selected.body ||
                (selected.error ? "No response body is available." : "Empty response body.")}
            </pre>
          )}
          {selected.truncated ? (
            <p className="text-xs text-muted-foreground">Response preview stopped at 256 KiB.</p>
          ) : null}
        </section>
      ) : null}
      <section aria-label="HTTP history" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Request history</h3>
          <div className="flex gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setHistoryPending(true);
                void refreshHistory();
              }}
              disabled={busy || !canUse}
            >
              Refresh history
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setConfirmClear(true)}
              disabled={busy || !canUse || !historyEntries?.length}
            >
              Clear history
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          The latest 50 exchanges are saved for this checkout on its computer. Authentication
          headers and credential query fields are redacted.
        </p>
        {canUse && historyPending && !historyEntries ? (
          <p role="status" className="text-sm">
            Reading history...
          </p>
        ) : null}
        {historyEntries?.length === 0 ? (
          <p className="text-sm text-muted-foreground">No saved requests.</p>
        ) : null}
        {canUse &&
          historyEntries?.map((exchange) => (
            <div key={exchange.id} className="grid grid-cols-[minmax(0,1fr)]">
              <Button
                type="button"
                size="sm"
                variant={selected?.id === exchange.id ? "secondary" : "ghost"}
                onClick={() => void refreshHistory(undefined, exchange.id)}
              >
                <span className="truncate">
                  {exchange.request.method} {exchange.status ?? exchange.error}{" "}
                  {exchange.request.url}
                </span>
              </Button>
            </div>
          ))}
      </section>
      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear this checkout's request history?</AlertDialogTitle>
            <AlertDialogDescription>
              Saved exchange payloads from all conversations sharing this checkout will be removed.
              Requests already sent are not undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setConfirmClear(false)}>
              Cancel
            </Button>
            <Button onClick={() => void clear()}>Clear history</Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}
