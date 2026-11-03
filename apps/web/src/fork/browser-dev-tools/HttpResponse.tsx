import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { useServerConfigs } from "~/state/entities";
import ResponseComparison from "./ResponseComparison";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useState } from "react";
import {
  ArrowDownToLineIcon,
  CopyIcon,
  MessageSquarePlusIcon,
  RotateCcwIcon,
  CheckIcon,
  CircleXIcon,
  CornerDownLeftIcon,
} from "lucide-react";
import type { DevHttpExchange } from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";
import { LabTabs } from "./HttpLabParts";
import { formatResponse } from "./apiRequestDraft";
type Tab = "body" | "headers" | "tests";
function statusName(status: number | null) {
  return (
    (
      {
        200: "OK",
        201: "Created",
        202: "Accepted",
        204: "No content",
        301: "Moved permanently",
        302: "Found",
        304: "Not modified",
        400: "Bad request",
        401: "Unauthorized",
        403: "Forbidden",
        404: "Not found",
        409: "Conflict",
        422: "Unprocessable content",
        429: "Too many requests",
        500: "Internal server error",
        502: "Bad gateway",
        503: "Service unavailable",
      } as Record<number, string>
    )[status ?? 0] ?? ""
  );
}
export default function HttpResponse({
  threadRef,
  exchange,
  checks = [],
  busy,
  onLoad,
  onAttach,
}: {
  threadRef: ScopedThreadRef;
  exchange: DevHttpExchange | null;
  checks?: readonly { name: string; passed: boolean }[];
  busy: boolean;
  onLoad: (exchange: DevHttpExchange) => void;
  onAttach: () => void;
}) {
  const supportsPulse = supportsLoomFeature(
    useServerConfigs().get(threadRef.environmentId)?.environment.capabilities,
    "pulse-workbench",
  );
  const [tab, setTab] = useState<Tab>("body");
  const [pretty, setPretty] = useState(true);
  const [wrap, setWrap] = useState(false);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const copy = useCopyToClipboard({
    target: "response",
    onError: () => setNotice("Could not copy the response. Try Download instead."),
  });
  const occurrences = new Map<string, number>();
  const checkRows = checks.map((check) => {
    const occurrence = (occurrences.get(check.name) ?? 0) + 1;
    occurrences.set(check.name, occurrence);
    return { ...check, key: `${check.name}:${occurrence}` };
  });
  const formatted = formatResponse(exchange?.body ?? "", pretty);
  const lines = formatted.split("\n");
  const matches = search
    ? lines.filter((line) => line.toLowerCase().includes(search.toLowerCase()))
    : lines;
  const download = () => {
    if (!exchange) return;
    const url = URL.createObjectURL(
      new Blob([exchange.body], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `response-${exchange.status ?? "error"}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section aria-label="HTTP response" className="min-w-0 border-t border-border">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-xs font-medium">Response</h3>
          {exchange ? (
            <>
              <span
                className={cn(
                  "rounded-md px-2 py-1 text-xs font-medium",
                  exchange.error || (exchange.status ?? 0) >= 400
                    ? "bg-destructive/10 text-destructive"
                    : "bg-success/10 text-success",
                )}
              >
                {exchange.error
                  ? exchange.error === "timeout"
                    ? "Timed out"
                    : "Network error"
                  : `${exchange.status} ${statusName(exchange.status)}`}
              </span>
              <span className="text-2xs tabular-nums text-muted-foreground">
                {exchange.durationMs} ms
              </span>
              <span className="text-2xs tabular-nums text-muted-foreground">
                {exchange.byteLength < 1024
                  ? `${exchange.byteLength} B`
                  : `${(exchange.byteLength / 1024).toFixed(1)} KiB`}
              </span>
            </>
          ) : null}
        </div>
        {exchange ? (
          <div className="flex gap-1">
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Load request from response"
              disabled={busy}
              onClick={() => onLoad(exchange)}
            >
              <RotateCcwIcon />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Add response to message"
              onClick={onAttach}
            >
              <MessageSquarePlusIcon />
            </Button>
          </div>
        ) : null}
      </div>
      {exchange ? (
        <>
          <p className="truncate px-4 pb-2 font-mono text-3xs text-muted-foreground">
            {exchange.request.method} {exchange.request.url}
          </p>
          <LabTabs
            label="Response views"
            value={tab}
            onChange={setTab}
            items={[
              { value: "body", label: "Body" },
              { value: "headers", label: "Headers", count: Object.keys(exchange.headers).length },
              { value: "tests", label: "Tests", count: checks.length },
            ]}
          >
            {tab === "body" ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="flex gap-1">
                    <Button
                      size="xs"
                      variant={pretty ? "secondary" : "ghost"}
                      onClick={() => setPretty(true)}
                    >
                      Pretty
                    </Button>
                    <Button
                      size="xs"
                      variant={!pretty ? "secondary" : "ghost"}
                      onClick={() => setPretty(false)}
                    >
                      Raw
                    </Button>
                    <Button
                      size="xs"
                      variant={wrap ? "secondary" : "ghost"}
                      aria-pressed={wrap}
                      onClick={() => setWrap(!wrap)}
                    >
                      Wrap
                    </Button>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Copy response body"
                      disabled={exchange.binary}
                      onClick={() => void copy.copyToClipboard(exchange.body, undefined)}
                    >
                      {copy.isCopied ? <CheckIcon /> : <CopyIcon />}
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Download response body"
                      disabled={exchange.binary}
                      onClick={download}
                    >
                      <ArrowDownToLineIcon />
                    </Button>
                  </div>
                </div>
                {!exchange.binary && exchange.body ? (
                  <>
                    <div className="px-3 pb-2">
                      <Input
                        size="compact"
                        aria-label="Find in response"
                        placeholder="Find in response..."
                        type="search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                    <pre
                      aria-label="Response body"
                      className={cn(
                        "max-h-[480px] min-h-44 overflow-auto bg-code px-4 py-3 font-mono text-xs leading-6",
                        wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre",
                      )}
                    >
                      {matches.join("\n") || (search ? "No matching lines." : "")}
                    </pre>
                    {search ? (
                      <p className="px-4 py-2 text-2xs text-muted-foreground">
                        {matches.length} matching lines
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="px-4 py-10 text-center text-xs text-muted-foreground">
                    {exchange.binary
                      ? `Binary response. ${exchange.byteLength} bytes captured.`
                      : exchange.error
                        ? "No response body. Check the URL and the execution computer's connection."
                        : "This response has no body."}
                  </p>
                )}
              </>
            ) : null}
            {tab === "headers" ? (
              <dl className="divide-y divide-border px-4 py-2">
                {Object.entries(exchange.headers).map(([key, value]) => (
                  <div
                    key={key}
                    className="grid gap-1 py-2 @min-[500px]:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
                  >
                    <dt className="break-all font-mono text-xs text-muted-foreground">{key}</dt>
                    <dd className="break-all font-mono text-xs">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {tab === "tests" ? (
              <div className="space-y-2 p-4">
                {checks.length ? (
                  <>
                    <p className="mb-3 text-xs text-muted-foreground">
                      {checks.filter((c) => c.passed).length} of {checks.length} checks passed
                    </p>
                    {checkRows.map((check) => (
                      <div key={check.key} className="flex items-start gap-2 text-xs">
                        {check.passed ? (
                          <CheckIcon className="size-4 shrink-0 text-success" />
                        ) : (
                          <CircleXIcon className="size-4 shrink-0 text-destructive" />
                        )}
                        <span className="break-all">{check.name}</span>
                      </div>
                    ))}
                  </>
                ) : (
                  <p className="py-6 text-center text-xs text-muted-foreground">
                    No checks recorded for this response. Add a response script to test it.
                  </p>
                )}
              </div>
            ) : null}
          </LabTabs>
          {supportsPulse ? (
            <ResponseComparison key={exchange.id} threadRef={threadRef} exchange={exchange} />
          ) : null}
          {exchange.truncated ? (
            <p role="status" className="p-3 text-xs text-warning-foreground">
              Response preview stopped at 256 KiB.
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="p-3 text-xs text-muted-foreground">
              {notice}
            </p>
          ) : null}
        </>
      ) : (
        <div className="flex min-h-52 flex-col items-center justify-center gap-3 p-6 text-center">
          <CornerDownLeftIcon className="size-6 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            {busy ? "Waiting for a response..." : "Send a request to see the response"}
          </p>
          <p className="text-xs text-muted-foreground/70">
            Status, timing, headers and test results appear here.
          </p>
        </div>
      )}
    </section>
  );
}
