import { useRef, useState } from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { DevApiAuthor, DevApiAuthorResult, DevApiDetails } from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { LabCodeEditor, LabSelect } from "./HttpLabParts";
import { devEnvironment as dev, runDevCommand } from "./state";
import { randomUUID } from "~/lib/utils";
export default function ApiAuthoring({
  threadRef,
  details,
  disabled,
  onUpdated,
}: {
  threadRef: ScopedThreadRef;
  details: DevApiDetails | null;
  disabled: boolean;
  onUpdated: (details: DevApiDetails) => void;
}) {
  const [action, setAction] = useState<DevApiAuthor["action"]>(details ? "request" : "workspace");
  const [name, setName] = useState("");
  const [folders, setFolders] = useState("");
  const [content, setContent] = useState("");
  const [review, setReview] = useState<{
    input: DevApiAuthor;
    changes: DevApiAuthorResult["changes"];
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ key: string; requestId: string } | null>(null);
  const run = async (apply = false) => {
    setBusy(true);
    setError("");
    const fields = {
      threadId: threadRef.threadId,
      action,
      name: name.trim(),
      folders: folders
        .split("/")
        .map((s) => s.trim())
        .filter(Boolean),
      ...(action === "workspace" || !details
        ? {}
        : { workspaceId: details.workspace.id, expectedRevision: details.revision }),
      content,
    };
    const key = JSON.stringify(fields);
    if (pending.current?.key !== key) pending.current = { key, requestId: randomUUID() };
    const input =
      apply && review
        ? { ...review.input, action: "openapi-apply" as const }
        : { ...fields, requestId: pending.current.requestId };
    try {
      const result = await runDevCommand(dev.apiAuthor, {
        environmentId: threadRef.environmentId,
        input,
      });
      if (action === "openapi-preview" && !apply && details)
        setReview({ input, changes: result.changes });
      else if (result.details) {
        onUpdated(result.details);
        setReview(null);
        setName("");
        setContent("");
        pending.current = null;
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not create or import this API. Check the source and reload if it changed.",
      );
    }
    setBusy(false);
  };
  return (
    <details className="border-b border-border px-4 py-3 text-xs">
      <summary className="cursor-pointer font-medium">Create or import</summary>
      <div className="mt-3 space-y-3">
        <LabSelect
          label="Create or import type"
          value={action}
          disabled={busy || disabled}
          onChange={(v) => {
            setAction(v as DevApiAuthor["action"]);
            setReview(null);
          }}
          options={[
            { value: "workspace", label: "Blank workspace" },
            ...(details
              ? [
                  { value: "request", label: "Blank request" },
                  { value: "folder", label: "Folder" },
                ]
              : []),
            { value: "curl", label: "Paste cURL" },
            { value: "openapi-preview", label: "Import or update OpenAPI" },
          ]}
        />
        <Input
          aria-label="New API name"
          placeholder={action === "workspace" ? "Workspace name" : "Name"}
          value={name}
          disabled={busy || disabled}
          onChange={(e) => {
            setName(e.target.value);
            setReview(null);
          }}
        />
        {details && ["request", "folder", "curl"].includes(action) ? (
          <Input
            aria-label="Destination folders"
            placeholder="Folder / Subfolder (optional)"
            value={folders}
            disabled={busy || disabled}
            onChange={(e) => setFolders(e.target.value)}
          />
        ) : null}
        {action === "curl" || action.startsWith("openapi") ? (
          <LabCodeEditor
            label={action === "curl" ? "cURL command" : "OpenAPI JSON or YAML"}
            value={content}
            disabled={busy || disabled}
            onChange={(v) => {
              setContent(v);
              setReview(null);
            }}
            placeholder={
              action === "curl"
                ? "curl 'https://example.com/api' -H 'Accept: application/json'"
                : "openapi: 3.1.0"
            }
          />
        ) : null}
        <Button
          size="sm"
          disabled={
            busy || disabled || !name.trim() || (action.startsWith("openapi") && !content.trim())
          }
          onClick={() => void run()}
        >
          {busy
            ? "Working..."
            : action === "openapi-preview" && details
              ? "Review specification changes"
              : action === "curl" || action.startsWith("openapi")
                ? "Import"
                : "Create"}
        </Button>
        {review ? (
          <div className="space-y-2 rounded-md bg-muted/40 p-3">
            <p>Specification changes</p>
            <ul className="space-y-1">
              {review.changes.map((change) => (
                <li key={change.id}>
                  {change.kind}: {change.name}
                </li>
              ))}
            </ul>
            {review.changes.length === 0 ? <p>No endpoint changes.</p> : null}
            <p className="text-muted-foreground">
              Customized requests keep their local edits. Removed endpoints with local edits are
              retained.
            </p>
            <Button size="sm" disabled={busy} onClick={() => void run(true)}>
              Apply reviewed import
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setReview(null)}>
              Cancel
            </Button>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </details>
  );
}
