import { useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  SaveSiteRequest,
  SaveSiteServiceRequest,
  SaveSiteCheckRequest,
  type SitesSnapshot,
} from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { useAtomCommand } from "~/state/use-atom-command";
import { LibraryDialog, LibraryField } from "../project-library/LibraryControls";
import { useLibraryPermission, useLibraryProjects } from "../project-library/state";
import { sites } from "./state";

const decodeSaveSiteRequest = Schema.decodeUnknownSync(SaveSiteRequest);
const decodeSaveSiteServiceRequest = Schema.decodeUnknownSync(SaveSiteServiceRequest);
const decodeSaveSiteCheckRequest = Schema.decodeUnknownSync(SaveSiteCheckRequest);
export type SiteEditTarget =
  | { kind: "site"; row?: SitesSnapshot["sites"][number] }
  | { kind: "service"; row?: SitesSnapshot["services"][number] }
  | { kind: "check"; row?: SitesSnapshot["checks"][number]; serviceId?: string };

export function SiteEditor({
  target,
  snapshot,
  environmentId,
  connected,
  onSaved,
  onClose,
}: {
  target: SiteEditTarget;
  snapshot: SitesSnapshot;
  environmentId: EnvironmentId;
  connected: boolean;
  onSaved: (id: string) => void;
  onClose: () => void;
}) {
  const row = target.row;
  const [id, setId] = useState(row?.id ?? "");
  const [name, setName] = useState(row?.name ?? "");
  const [url, setUrl] = useState(row?.url ?? "");
  const [active, setActive] = useState(row ? Boolean(row.active) : true);
  const [origins, setOrigins] = useState(
    target.kind === "site" ? (target.row?.origins.join("\n") ?? "") : "",
  );
  const [projectIds, setProjects] = useState<readonly string[]>(
    target.kind === "site" ? (target.row?.projectIds ?? []) : [],
  );
  const [serviceIds, setServices] = useState<readonly string[]>(
    target.kind === "site" ? (target.row?.serviceIds ?? []) : [],
  );
  const [kind, setKind] = useState(
    target.kind === "service" ? (target.row?.kind ?? "website") : "website",
  );
  const [serviceId, setServiceId] = useState(
    target.kind === "check"
      ? (target.row?.service_id ?? target.serviceId ?? snapshot.services[0]?.id ?? "")
      : "",
  );
  const [status, setStatus] = useState(
    target.kind === "check" ? String(target.row?.expected_status ?? 200) : "200",
  );
  const [content, setContent] = useState(
    target.kind === "check" ? (target.row?.content ?? "") : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const catalog = useLibraryProjects(true);
  const saveSite = useAtomCommand(sites.saveSite, { reportFailure: false });
  const saveService = useAtomCommand(sites.saveService, { reportFailure: false });
  const saveCheck = useAtomCommand(sites.saveCheck, { reportFailure: false });
  const allowed = useLibraryPermission(sites.saveSite, environmentId);
  const toggle = (values: readonly string[], value: string) =>
    values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
  const submit = async () => {
    if (busy || !allowed || !connected) return;
    setError(null);
    setBusy(true);
    try {
      const base = { id, name, url, active };
      const result =
        target.kind === "site"
          ? await saveSite({
              environmentId,
              input: decodeSaveSiteRequest({
                ...base,
                origins: origins
                  .split(/\r?\n/)
                  .map((v) => v.trim())
                  .filter(Boolean),
                projectIds,
                serviceIds,
              }),
            })
          : target.kind === "service"
            ? await saveService({
                environmentId,
                input: decodeSaveSiteServiceRequest({ ...base, kind }),
              })
            : await saveCheck({
                environmentId,
                input: decodeSaveSiteCheckRequest({
                  ...base,
                  service_id: serviceId,
                  expected_status: Number(status),
                  content,
                }),
              });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      onSaved(id);
    } catch (cause) {
      setError(
        Schema.isSchemaError(cause)
          ? "Check the required fields, HTTPS URLs, and project selection."
          : cause instanceof Error
            ? cause.message
            : "Could not save. Refresh and try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const title =
    target.kind === "site" ? "site" : target.kind === "service" ? "service" : "endpoint check";
  return (
    <LibraryDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title={`${row ? "Edit" : "Register"} ${title}`}
      description="Pause entries to retain their identity and history. Shared services can be used by several sites."
      actions={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            form="site-editor"
            type="submit"
            disabled={
              busy || !connected || !allowed || (target.kind === "site" && !projectIds.length)
            }
          >
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </>
      }
    >
      <form
        id="site-editor"
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <fieldset disabled={busy} className="space-y-4">
          <LibraryField label="Name">
            <Input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </LibraryField>
          <LibraryField label="Stable ID">
            <Input
              required
              pattern="[a-z0-9][a-z0-9-]{0,63}"
              maxLength={64}
              readOnly={Boolean(row)}
              value={id}
              onChange={(e) => setId(e.target.value)}
            />
          </LibraryField>
          <LibraryField label={target.kind === "check" ? "Check URL" : "HTTPS origin"}>
            <Input
              required
              type="url"
              placeholder="https://example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </LibraryField>
          {target.kind === "site" ? (
            <>
              <LibraryField label="Analytics origins">
                <Textarea
                  required
                  rows={3}
                  placeholder="https://example.com"
                  value={origins}
                  onChange={(e) => setOrigins(e.target.value)}
                />
              </LibraryField>
              <p className="text-xs text-muted-foreground">
                One exact origin per line, including the site's own origin.
              </p>
              <fieldset className="space-y-2">
                <legend className="mb-2 text-sm font-medium">Projects (at least one)</legend>
                {catalog.query.isPending ? <p role="status">Loading projects…</p> : null}
                {catalog.query.error ? <p role="alert">{catalog.query.error}</p> : null}
                {catalog.query.data?.map((project) => (
                  <label key={project.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={projectIds.includes(project.id)}

                      onChange={() => setProjects(toggle(projectIds, project.id))}
                    />
                    {project.title}
                    {project.archived ? " (archived)" : ""}
                  </label>
                ))}
                {!catalog.query.isPending && !catalog.query.data?.length ? (
                  <p className="text-sm">Create a project in Projects before registering a site.</p>
                ) : null}
                {projectIds
                  .filter((id) => !catalog.query.data?.some((p) => p.id === id))
                  .map((id) => (
                    <label key={id} className="flex gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked
                        onChange={() => setProjects(toggle(projectIds, id))}
                      />
                      Unavailable project ({id}). Choose a replacement.
                    </label>
                  ))}
              </fieldset>
              <fieldset className="space-y-2">
                <legend className="mb-2 text-sm font-medium">Services this site uses</legend>
                {snapshot.services.map((service) => (
                  <label key={service.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={serviceIds.includes(service.id)}
                      onChange={() => setServices(toggle(serviceIds, service.id))}
                    />
                    {service.name}
                  </label>
                ))}
              </fieldset>
            </>
          ) : target.kind === "service" ? (
            <fieldset className="flex gap-3">
              <legend className="mb-2 text-sm font-medium">Kind</legend>
              {(["website", "api", "redirect"] as const).map((value) => (
                <label key={value} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="kind"
                    value={value}
                    checked={kind === value}
                    onChange={() => setKind(value)}
                  />
                  {value === "api" ? "API" : value}
                </label>
              ))}
            </fieldset>
          ) : (
            <>
              <fieldset className="space-y-2">
                <legend className="mb-2 text-sm font-medium">Service</legend>
                {snapshot.services.map((service) => (
                  <label key={service.id} className="flex items-center gap-2 text-sm">
                    <input
                      required
                      type="radio"
                      name="service"
                      checked={serviceId === service.id}
                      onChange={() => setServiceId(service.id)}
                    />
                    {service.name}
                  </label>
                ))}
              </fieldset>
              <LibraryField label="Expected HTTP status">
                <Input
                  type="number"
                  required
                  min={200}
                  max={399}
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                />
              </LibraryField>
              <LibraryField label="Expected response text (optional)">
                <Input
                  maxLength={120}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                />
              </LibraryField>
              <p className="text-xs text-muted-foreground">
                The URL must use the service's origin. Redirects are not followed.
              </p>
            </>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active
          </label>
        </fieldset>
        {error ? (
          <p role="alert" className="text-sm text-destructive-foreground">
            {error}
          </p>
        ) : null}
      </form>
    </LibraryDialog>
  );
}
