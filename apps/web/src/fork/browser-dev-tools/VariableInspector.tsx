import { useState } from "react";
import type { DevApiVariable } from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { explainVariables } from "./variableResolution";
export default function VariableInspector({
  request,
  inherited,
  environment,
  source,
  disabled,
  onEditEnvironment,
  onEditRequest,
}: {
  request: Record<string, unknown>;
  inherited: readonly DevApiVariable[];
  environment: readonly DevApiVariable[];
  source: string;
  disabled: boolean;
  onEditEnvironment: (key: string) => void;
  onEditRequest: (key: string, value: string) => void;
}) {
  const [selected, setSelected] = useState("");
  const rows = explainVariables(request, inherited, environment, source);
  const row = rows.find((r) => r.key === selected);
  return rows.length ? (
    <section
      aria-label="Variable references"
      className="space-y-2 border-t border-border px-4 py-3"
    >
      <div className="flex flex-wrap gap-1">
        {rows.map((r) => (
          <Button
            key={r.key}
            size="xs"
            variant={selected === r.key ? "secondary" : "ghost"}
            onClick={() => setSelected(r.key)}
            aria-label={`Explain ${r.key}`}
          >
            {`<<${r.key}>>`}
            {r.status.includes("Missing") || r.status.includes("Circular") ? " !" : ""}
          </Button>
        ))}
      </div>
      {row ? (
        <div className="space-y-2 rounded-md bg-muted/40 p-3 text-xs">
          <p>
            <strong>{row.key}</strong> · {row.source}
          </p>
          <p role="status">{row.status}</p>
          {row.secret ? (
            <p className="text-muted-foreground">
              Value hidden. Credentials are never shown in this inspector.
            </p>
          ) : row.value ? (
            <p className="break-all font-mono">{row.value}</p>
          ) : null}
          {row.request ? (
            <label className="block space-y-1">
              <span>Edit request variable</span>
              <Input
                type={row.secret ? "password" : "text"}
                aria-label={`Request variable ${row.key}`}
                disabled={disabled}
                defaultValue={row.value}
                key={row.key}
                onChange={(e) => onEditRequest(row.key, e.target.value)}
              />
            </label>
          ) : (
            <Button
              size="xs"
              variant="outline"
              disabled={disabled}
              onClick={() => onEditEnvironment(row.key)}
            >
              {source === "No environment"
                ? "Define request variable"
                : "Edit environment variable"}
            </Button>
          )}
        </div>
      ) : (
        <p className="text-2xs text-muted-foreground">
          Select a reference to see its source and resolution.
        </p>
      )}
    </section>
  ) : null;
}
