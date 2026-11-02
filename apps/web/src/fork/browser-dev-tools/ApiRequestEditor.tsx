import { useState } from "react";
import { PlusIcon, Trash2Icon, WandSparklesIcon, ShieldCheckIcon, FileUpIcon } from "lucide-react";
import type { DevApiDetails } from "@t3tools/contracts/fork";
import { randomUUID } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Checkbox } from "~/components/ui/checkbox";
import { LabTabs, LabCodeEditor, LabSelect } from "./HttpLabParts";
import { draftObject, draftRows, draftText, formatResponse } from "./apiRequestDraft";

type Tab = "params" | "body" | "headers" | "auth" | "scripts";
function Pairs({
  label,
  rows,
  disabled,
  onChange,
}: {
  label: string;
  rows: readonly Record<string, unknown>[];
  disabled: boolean;
  onChange: (rows: readonly Record<string, unknown>[]) => void;
}) {
  const [rowKeys, setRowKeys] = useState(() => rows.map(() => randomUUID()));
  return (
    <div className="p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{label}</p>
        <Button
          size="xs"
          variant="ghost"
          disabled={disabled}
          onClick={() => {
            setRowKeys([...rowKeys, randomUUID()]);
            onChange([...rows, { key: "", value: "", active: true }]);
          }}
        >
          <PlusIcon />
          Add row
        </Button>
      </div>
      {rows.length ? (
        <div className="divide-y divide-border rounded-lg border border-border">
          {rows.map((row, index) => (
            <div
              className="grid grid-cols-[20px_minmax(0,1fr)_minmax(0,1fr)_28px] items-center gap-2 p-2"
              key={rowKeys[index]}
            >
              <Checkbox
                aria-label={`Enable ${label} ${index + 1}`}
                checked={row.active !== false}
                disabled={disabled}
                onCheckedChange={(checked) =>
                  onChange(
                    rows.map((r, i) => (i === index ? { ...r, active: checked === true } : r)),
                  )
                }
              />
              <Input
                aria-label={`${label} key ${index + 1}`}
                value={draftText(row.key)}
                placeholder="Key"
                disabled={disabled}
                onChange={(e) =>
                  onChange(rows.map((r, i) => (i === index ? { ...r, key: e.target.value } : r)))
                }
              />
              <Input
                aria-label={`${label} value ${index + 1}`}
                value={draftText(row.value)}
                placeholder="Value or <<variable>>"
                disabled={disabled}
                onChange={(e) =>
                  onChange(rows.map((r, i) => (i === index ? { ...r, value: e.target.value } : r)))
                }
              />
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Remove ${label} ${index + 1}`}
                disabled={disabled}
                onClick={() => {
                  setRowKeys(rowKeys.filter((_, i) => i !== index));
                  onChange(rows.filter((_, i) => i !== index));
                }}
              >
                <Trash2Icon />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
          No {label.toLowerCase()}. Add a row to include one.
        </div>
      )}
    </div>
  );
}
export default function ApiRequestEditor({
  selected,
  draft,
  onChange,
  disabled,
  bodyFileName,
  onUpload,
}: {
  selected: NonNullable<DevApiDetails["selected"]>;
  draft: string;
  onChange: (value: string) => void;
  disabled: boolean;
  bodyFileName: string;
  onUpload: (file: File | undefined) => void;
}) {
  const [tab, setTab] = useState<Tab>("params");
  const [script, setScript] = useState<"preRequestScript" | "testScript">("preRequestScript");
  const source = draftObject(JSON.parse(draft));
  const body = draftObject(source.body);
  const auth = draftObject(source.auth);
  const update = (patch: Record<string, unknown>) =>
    onChange(JSON.stringify({ ...source, ...patch }));
  const authType = draftText(auth.authType) || "inherit";
  const fields =
    authType === "bearer"
      ? [{ key: "token", label: "Token" }]
      : authType === "basic"
        ? [
            { key: "username", label: "Username" },
            { key: "password", label: "Password" },
          ]
        : authType === "api-key"
          ? [
              { key: "key", label: "Key" },
              { key: "value", label: "Value" },
            ]
          : [];
  const inheritedScripts =
    script === "preRequestScript" ? selected.preScripts : selected.testScripts;
  return (
    <LabTabs
      label="Request settings"
      value={tab}
      onChange={setTab}
      items={[
        {
          value: "params",
          label: "Params",
          count: draftRows(source.params).filter((r) => r.active !== false).length,
        },
        { value: "body", label: "Body" },
        {
          value: "headers",
          label: "Headers",
          count: draftRows(source.headers).filter((r) => r.active !== false).length,
        },
        { value: "auth", label: "Auth" },
        {
          value: "scripts",
          label: "Scripts",
          count: selected.preScripts.length + selected.testScripts.length,
        },
      ]}
    >
      {tab === "params" || tab === "headers" ? (
        <Pairs
          key={tab}
          label={tab === "params" ? "Query parameters" : "Request headers"}
          rows={draftRows(source[tab])}
          disabled={disabled}
          onChange={(rows) => update({ [tab]: rows })}
        />
      ) : null}
      {tab === "body" ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 p-3">
            <div className="w-48">
              <LabSelect
                label="Body content type"
                value={draftText(body.contentType) || "none"}
                disabled={disabled}
                onChange={(value) =>
                  update({
                    body: {
                      ...body,
                      contentType: value === "none" ? null : value,
                      body: draftText(body.body),
                    },
                  })
                }
                options={[
                  { value: "none", label: "No body" },
                  { value: "application/json", label: "JSON" },
                  { value: "text/plain", label: "Plain text" },
                  { value: "application/xml", label: "XML" },
                  { value: "application/x-www-form-urlencoded", label: "Form URL encoded" },
                  { value: "application/octet-stream", label: "Binary file" },
                  ...(body.contentType &&
                  ![
                    "application/json",
                    "text/plain",
                    "application/xml",
                    "application/x-www-form-urlencoded",
                    "application/octet-stream",
                  ].includes(draftText(body.contentType))
                    ? [{ value: draftText(body.contentType), label: draftText(body.contentType) }]
                    : []),
                ]}
              />
            </div>
            {body.contentType === "application/json" ? (
              <Button
                size="xs"
                variant="ghost"
                disabled={disabled}
                onClick={() =>
                  update({ body: { ...body, body: formatResponse(draftText(body.body), true) } })
                }
              >
                <WandSparklesIcon />
                Format JSON
              </Button>
            ) : null}
          </div>
          {body.contentType === "application/octet-stream" ? (
            <div className="space-y-3 px-4 pb-5">
              <div className="flex items-center gap-2 text-sm">
                <FileUpIcon className="size-4 text-muted-foreground" />
                {bodyFileName || "Choose a file to send"}
              </div>
              <input
                aria-label="Binary upload file"
                type="file"
                disabled={disabled}
                className="max-w-full text-xs"
                onChange={(e) => {
                  onUpload(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <p className="text-xs text-muted-foreground">
                Up to 128 KiB. File contents are used for this request.
              </p>
            </div>
          ) : body.contentType === "application/x-www-form-urlencoded" ? (
            <Pairs
              label="Form fields"
              rows={draftRows(body.body)}
              disabled={disabled}
              onChange={(rows) => update({ body: { ...body, body: rows } })}
            />
          ) : body.contentType ? (
            <LabCodeEditor
              label="Request body"
              value={draftText(body.body)}
              disabled={disabled}
              onChange={(value) => update({ body: { ...body, body: value } })}
              placeholder={'{\n  "name": "<<name>>"\n}'}
            />
          ) : (
            <p className="px-4 pb-8 pt-3 text-xs text-muted-foreground">
              This request has no body.
            </p>
          )}
        </>
      ) : null}
      {tab === "auth" ? (
        <div className="space-y-4 p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheckIcon className="size-4" />
            Use environment variables for credentials, including Vault-backed values.
          </div>
          <div className="max-w-xs">
            <LabSelect
              label="Authorization type"
              value={authType}
              disabled={disabled}
              options={[
                { value: "inherit", label: "Inherit from collection" },
                { value: "none", label: "No authentication" },
                { value: "bearer", label: "Bearer token" },
                { value: "basic", label: "Basic auth" },
                { value: "api-key", label: "API key" },
                ...(!["inherit", "none", "bearer", "basic", "api-key"].includes(authType)
                  ? [{ value: authType, label: `${authType} (preserved)` }]
                  : []),
              ]}
              onChange={(value) => update({ auth: { ...auth, authType: value, authActive: true } })}
            />
          </div>
          {authType !== "none" && authType !== "inherit" ? (
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                aria-label="Use authentication"
                checked={auth.authActive !== false}
                disabled={disabled}
                onCheckedChange={(checked) =>
                  update({ auth: { ...auth, authActive: checked === true } })
                }
              />
              Use authentication
            </label>
          ) : null}
          {fields.map((field) => (
            <label key={field.key} className="block space-y-1.5 text-xs">
              <span>{field.label}</span>
              <Input
                aria-label={`Auth ${field.label}`}
                autoComplete="off"
                type={
                  field.key === "password" || field.key === "token" || field.key === "value"
                    ? "password"
                    : "text"
                }
                value={draftText(auth[field.key])}
                disabled={disabled}
                placeholder={`<<${field.key}>>`}
                onChange={(e) => update({ auth: { ...auth, [field.key]: e.target.value } })}
              />
            </label>
          ))}
          {authType === "api-key" ? (
            <div className="max-w-xs">
              <LabSelect
                label="API key location"
                value={draftText(auth.addTo) || "Headers"}
                disabled={disabled}
                options={[
                  { value: "Headers", label: "Header" },
                  { value: "Query params", label: "Query parameter" },
                ]}
                onChange={(value) => update({ auth: { ...auth, addTo: value } })}
              />
            </div>
          ) : null}
          {authType === "inherit" ? (
            <p className="text-xs text-muted-foreground">
              The collection's authentication is applied when this request runs.
            </p>
          ) : null}
        </div>
      ) : null}
      {tab === "scripts" ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 p-3">
            <div className="w-48">
              <LabSelect
                label="Script phase"
                value={script}
                disabled={disabled}
                options={[
                  { value: "preRequestScript", label: "Before request" },
                  { value: "testScript", label: "After response" },
                ]}
                onChange={(value) =>
                  setScript(value === "testScript" ? "testScript" : "preRequestScript")
                }
              />
            </div>
            <span className="text-xs text-muted-foreground">pw.env · pw.test · pw.expect</span>
          </div>
          <LabCodeEditor
            label={script === "preRequestScript" ? "Pre-request script" : "Response script"}
            value={draftText(source[script])}
            onChange={(value) => update({ [script]: value })}
            disabled={disabled}
            placeholder={
              script === "preRequestScript"
                ? 'pw.env.set("name", "value");'
                : 'pw.test("OK", () => pw.expect(pw.response.status).toBe(200));'
            }
          />
          {inheritedScripts.length > (draftText(source[script]) ? 1 : 0) ? (
            <details className="p-3 text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                Collection scripts also run
              </summary>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-2xs">
                {inheritedScripts.join("\n\n")}
              </pre>
            </details>
          ) : null}
        </>
      ) : null}
    </LabTabs>
  );
}
