import { useState } from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { DevHttpBaselines, DevHttpExchange, DevHttpSummary } from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { LabSelect } from "./HttpLabParts";
import { devEnvironment as dev, runDevCommand } from "./state";
import { compareResponses, sameEndpoint } from "./responseDiff";
import { randomUUID } from "~/lib/utils";
export default function ResponseComparison({
  threadRef,
  exchange,
}: {
  threadRef: ScopedThreadRef;
  exchange: DevHttpExchange;
}) {
  const [baselines, setBaselines] = useState<DevHttpBaselines | null>(null);
  const [history, setHistory] = useState<readonly DevHttpSummary[]>([]);
  const [before, setBefore] = useState<DevHttpExchange | null>(null);
  const [selection, setSelection] = useState("");
  const [ignored, setIgnored] = useState("/headers/date");
  const [name, setName] = useState("Known good");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const target = {
    environmentId: threadRef.environmentId,
    input: { threadId: threadRef.threadId },
  };
  const load = async () => {
    setBusy(true);
    setError("");
    try {
      const [saved, recent] = await Promise.all([
        runDevCommand(dev.httpBaseline, { ...target, input: { ...target.input, action: "read" } }),
        runDevCommand(dev.httpHistory, target),
      ]);
      setBaselines(saved);
      setHistory(recent.exchanges);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Comparisons are unavailable. Update this computer if it does not support baselines.",
      );
    }
    setBusy(false);
  };
  const select = async (value: string) => {
    setSelection(value);
    setError("");
    if (value.startsWith("b:")) {
      const baseline = baselines?.baselines.find((b) => b.id === value.slice(2));
      setBefore(baseline?.exchange ?? null);
      setIgnored(baseline?.ignoredPaths.join(", ") ?? "");
      return;
    }
    setBusy(true);
    try {
      setBefore(
        (
          await runDevCommand(dev.httpHistory, {
            ...target,
            input: { ...target.input, exchangeId: value },
          })
        ).selected,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "The response is unavailable.");
    }
    setBusy(false);
  };
  const pin = async (remove = false) => {
    if (!baselines) return;
    setBusy(true);
    setError("");
    try {
      const value = await runDevCommand(dev.httpBaseline, {
        ...target,
        input: {
          ...target.input,
          action: remove ? "remove" : "pin",
          expectedRevision: baselines.revision,
          id: remove ? selection.slice(2) : randomUUID(),
          exchangeId: exchange.id,
          name,
          ignoredPaths: ignored
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean),
        },
      });
      setBaselines(value);
      if (remove) {
        setBefore(null);
        setSelection("");
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The baseline could not be saved. Reload to see the latest baselines.",
      );
    }
    setBusy(false);
  };
  const changes = before
    ? compareResponses(
        before,
        exchange,
        ignored.split(",").map((p) => p.trim()),
      )
    : [];
  return (
    <details
      className="border-t border-border p-4 text-xs"
      onToggle={(e) => {
        if (e.currentTarget.open && !baselines && !busy) void load();
      }}
    >
      <summary className="cursor-pointer font-medium">Compare responses and baselines</summary>
      <div className="mt-3 space-y-3">
        <LabSelect
          label="Compare against"
          value={selection}
          disabled={busy}
          onChange={(v) => void select(v)}
          options={[
            { value: "", label: "Choose a response" },
            ...(baselines?.baselines
              .filter((b) => sameEndpoint(b.exchange.request, exchange.request))
              .map((b) => ({ value: `b:${b.id}`, label: `Baseline: ${b.name}` })) ?? []),
            ...history
              .filter((h) => h.id !== exchange.id && sameEndpoint(h.request, exchange.request))
              .map((h) => ({
                value: h.id,
                label: `${h.status ?? h.error} · ${h.request.url} · ${h.startedAt}`,
              })),
          ]}
        />
        <label className="block space-y-1">
          <span>Ignore paths (comma separated)</span>
          <Input
            aria-label="Ignore comparison paths"
            value={ignored}
            onChange={(e) => setIgnored(e.target.value)}
            placeholder="/body/id, /body/updatedAt, /headers/date"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <div className="min-w-0 flex-1">
            <Input
              aria-label="Baseline name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={
              busy ||
              !baselines ||
              !name.trim() ||
              Boolean(exchange.error) ||
              exchange.binary ||
              exchange.truncated
            }
            onClick={() => void pin()}
          >
            Pin current response
          </Button>
          {selection.startsWith("b:") ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void pin(true)}>
              Remove baseline
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void load()}>
            Reload
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
        {before ? (
          <div>
            <p role="status" className="mb-2">
              {changes.length
                ? `${changes.length}${changes.length === 1000 ? "+" : ""} changed paths`
                : "No differences outside ignored paths."}
              {before.truncated || exchange.truncated ? " Response previews are incomplete." : ""}
            </p>
            <div className="max-h-96 space-y-2 overflow-auto">
              {changes.map((change) => (
                <details key={change.path} className="rounded-md bg-muted/30 p-2">
                  <summary className="cursor-pointer break-all font-mono">{change.path}</summary>
                  <pre className="mt-2 whitespace-pre-wrap break-all text-destructive">
                    {change.before}
                  </pre>
                  <pre className="mt-2 whitespace-pre-wrap break-all text-success">
                    {change.after}
                  </pre>
                </details>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </details>
  );
}
