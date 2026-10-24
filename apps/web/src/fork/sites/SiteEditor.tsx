import { useState, type ReactNode } from "react";
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
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Radio, RadioGroup } from "~/components/ui/radio-group";
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { cn } from "~/lib/utils";
import { useAtomCommand } from "~/state/use-atom-command";
import { LibraryDialog, LibraryField } from "../project-library/LibraryControls";
import { ProjectTile } from "../project-library/ProjectIdentity";
import { useLibraryPermission, useLibraryProjects } from "../project-library/state";
import { SERVICE_KINDS, siteHost } from "./SiteHealth";
import { sites } from "./state";

const decodeSaveSiteRequest = Schema.decodeUnknownSync(SaveSiteRequest);
const decodeSaveSiteServiceRequest = Schema.decodeUnknownSync(SaveSiteServiceRequest);
const decodeSaveSiteCheckRequest = Schema.decodeUnknownSync(SaveSiteCheckRequest);
export type SiteEditTarget =
  | { kind: "site"; row?: SitesSnapshot["sites"][number] }
  | { kind: "service"; row?: SitesSnapshot["services"][number] }
  | { kind: "check"; row?: SitesSnapshot["checks"][number]; serviceId?: string };

const SERVICE_KIND_ORDER = ["website", "api", "redirect"] as const;

/** The ID a new entry would get from its name; the person can still change it before saving. */
function idFromName(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** The scheme and host of a URL, or nothing while it is still being typed. */
function originOf(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

const NOUNS = { site: "site", service: "service", check: "endpoint check" } as const;
const DESCRIPTIONS = {
  site: "A site is the address people visit. Link it to the projects it serves and the services it runs on.",
  service: "A service is an origin a site depends on. Several sites can share one.",
  check: "Loom requests this URL on a schedule and reports when the answer changes.",
} as const;

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
  // A new entry's ID follows its name until someone types an ID of their own.
  const [idEdited, setIdEdited] = useState(Boolean(row));
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
  const changeName = (next: string) => {
    setName(next);
    if (!idEdited) setId(idFromName(next));
  };
  // The site's own origin must be among its analytics origins; keep it there as the URL changes.
  const changeUrl = (next: string) => {
    if (target.kind === "site") {
      const before = originOf(url);
      const after = originOf(next);
      const lines = origins.split(/\r?\n/).filter((line) => line.trim() && line.trim() !== before);
      setOrigins((after ? [after, ...lines] : lines).join("\n"));
    }
    setUrl(next);
  };
  const service = snapshot.services.find((entry) => entry.id === serviceId);
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
  const missingProject = target.kind === "site" && !projectIds.length;
  return (
    <LibraryDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title={`${row ? "Edit" : "Register"} ${NOUNS[target.kind]}`}
      description={DESCRIPTIONS[target.kind]}
      actions={
        <>
          <Button shape="pill" variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            shape="pill"
            form="site-editor"
            type="submit"
            disabled={busy || !connected || !allowed || missingProject}
          >
            {busy ? "Saving…" : row ? "Save changes" : `Register ${NOUNS[target.kind]}`}
          </Button>
        </>
      }
    >
      <form
        id="site-editor"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <fieldset disabled={busy} className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)]">
            <LibraryField label="Name">
              <Input
                required
                maxLength={120}
                value={name}
                onChange={(e) => changeName(e.target.value)}
              />
            </LibraryField>
            <LibraryField label="ID">
              <Input
                required
                pattern="[a-z0-9][a-z0-9-]{0,63}"
                maxLength={64}
                readOnly={Boolean(row)}
                value={id}
                onChange={(e) => {
                  setIdEdited(true);
                  setId(e.target.value);
                }}
              />
            </LibraryField>
          </div>
          <p className="-mt-3 text-xs text-muted-foreground">
            {row
              ? "The ID keeps this entry's history together, so it stays fixed."
              : "Lowercase letters, numbers and dashes. It can't change after saving."}
          </p>
          <LibraryField label={target.kind === "check" ? "URL to request" : "HTTPS origin"}>
            <Input
              required
              type="url"
              placeholder={
                target.kind === "check" && service ? `${service.url}/health` : "https://example.com"
              }
              value={url}
              onChange={(e) => changeUrl(e.target.value)}
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
              <p className="-mt-3 text-xs text-muted-foreground">
                One exact origin per line. Visits from anywhere else are not counted.
              </p>
              <ChoiceGroup legend="Serves these projects" hint="At least one">
                {catalog.query.isPending ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    Loading projects…
                  </p>
                ) : null}
                {catalog.query.error ? (
                  <p role="alert" className="text-sm text-destructive-foreground">
                    {catalog.query.error}
                  </p>
                ) : null}
                {catalog.query.data?.map((project) => (
                  <Choice
                    key={project.id}
                    control={
                      <Checkbox
                        checked={projectIds.includes(project.id)}
                        onCheckedChange={() => setProjects(toggle(projectIds, project.id))}
                      />
                    }
                    leading={<ProjectTile project={project} size="sm" />}
                    title={project.title}
                    detail={project.archived ? "Archived" : undefined}
                  />
                ))}
                {!catalog.query.isPending && !catalog.query.data?.length ? (
                  <p className="text-sm text-muted-foreground">
                    Create a project in Projects before registering a site.
                  </p>
                ) : null}
                {projectIds
                  .filter((id) => !catalog.query.data?.some((p) => p.id === id))
                  .map((id) => (
                    <Choice
                      key={id}
                      control={
                        <Checkbox
                          checked
                          onCheckedChange={() => setProjects(toggle(projectIds, id))}
                        />
                      }
                      title="Unavailable project"
                      detail={`${id}. Choose a replacement.`}
                    />
                  ))}
              </ChoiceGroup>
              <ChoiceGroup legend="Runs on these services">
                {snapshot.services.length ? (
                  snapshot.services.map((entry) => {
                    const KindIcon = SERVICE_KINDS[entry.kind].icon;
                    return (
                      <Choice
                        key={entry.id}
                        control={
                          <Checkbox
                            checked={serviceIds.includes(entry.id)}
                            onCheckedChange={() => setServices(toggle(serviceIds, entry.id))}
                          />
                        }
                        leading={<KindIcon aria-hidden className="size-4 text-muted-foreground" />}
                        title={entry.name}
                        detail={siteHost(entry.url)}
                        mono
                      />
                    );
                  })
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No services registered yet. Register one under Services to watch it.
                  </p>
                )}
              </ChoiceGroup>
            </>
          ) : target.kind === "service" ? (
            <div className="flex flex-col gap-2">
              <p id="site-service-kind" className="text-sm font-medium">
                Kind
              </p>
              <ToggleGroup
                shape="pill"
                variant="segmented"
                aria-labelledby="site-service-kind"
                value={[kind]}
                onValueChange={(value) => {
                  const next = SERVICE_KIND_ORDER.find((entry) => entry === value[0]);
                  if (next) setKind(next);
                }}
              >
                {SERVICE_KIND_ORDER.map((value) => {
                  const KindIcon = SERVICE_KINDS[value].icon;
                  return (
                    <ToggleGroupItem key={value} value={value}>
                      <KindIcon />
                      {SERVICE_KINDS[value].label}
                    </ToggleGroupItem>
                  );
                })}
              </ToggleGroup>
            </div>
          ) : (
            <>
              <ChoiceGroup legend="Service">
                <RadioGroup
                  value={serviceId}
                  onValueChange={(value) => {
                    const next = snapshot.services.find((entry) => entry.id === value);
                    if (!next) return;
                    setServiceId(next.id);
                    if (!url.trim()) setUrl(next.url);
                  }}
                >
                  {snapshot.services.map((entry) => (
                    <Choice
                      key={entry.id}
                      control={<Radio value={entry.id} />}
                      title={entry.name}
                      detail={siteHost(entry.url)}
                      mono
                    />
                  ))}
                </RadioGroup>
              </ChoiceGroup>
              <div className="grid gap-4 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
                <LibraryField label="Expected status">
                  <Input
                    type="number"
                    required
                    min={200}
                    max={399}
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                  />
                </LibraryField>
                <LibraryField label="Expected text (optional)">
                  <Input
                    maxLength={120}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                  />
                </LibraryField>
              </div>
              <p className="-mt-3 text-xs text-muted-foreground">
                The URL must use the service's origin. Redirects are not followed.
              </p>
            </>
          )}

          <label className="flex items-center justify-between gap-4 rounded-xl bg-muted/50 px-3.5 py-3 dark:bg-accent/50">
            <span className="min-w-0">
              <span className="block text-sm font-medium">
                {target.kind === "check" ? "Check on a schedule" : "Active"}
              </span>
              <span className="block text-xs text-muted-foreground">
                Pausing keeps the {NOUNS[target.kind]} and its history.
              </span>
            </span>
            <Switch checked={active} onCheckedChange={setActive} />
          </label>
        </fieldset>
        {error ? (
          <p role="alert" className="mt-4 text-sm text-destructive-foreground">
            {error}
          </p>
        ) : null}
      </form>
    </LibraryDialog>
  );
}

function ChoiceGroup({
  legend,
  hint,
  children,
}: {
  readonly legend: string;
  readonly hint?: string;
  readonly children: ReactNode;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 flex items-baseline gap-2 text-sm font-medium">
        {legend}
        {hint ? <span className="text-xs font-normal text-muted-foreground">{hint}</span> : null}
      </legend>
      <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-xl border border-border p-1">
        {children}
      </div>
    </fieldset>
  );
}

function Choice({
  control,
  leading,
  title,
  detail,
  mono = false,
}: {
  readonly control: ReactNode;
  readonly leading?: ReactNode;
  readonly title: string;
  readonly detail?: string | undefined;
  /** For details that are addresses, which read better in fixed width. */
  readonly mono?: boolean;
}) {
  return (
    <label className="flex min-w-0 cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition-colors duration-150 hover:bg-accent/50">
      {control}
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{title}</span>
        {detail ? (
          <span
            className={cn(
              "block truncate text-muted-foreground",
              mono ? "font-mono text-2xs" : "text-xs",
            )}
          >
            {detail}
          </span>
        ) : null}
      </span>
    </label>
  );
}
