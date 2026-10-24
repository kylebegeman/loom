import { useId, useState, type ReactNode } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  SaveSiteCheckRequest,
  SaveSiteRequest,
  SaveSiteServiceRequest,
  SiteId,
  type LibraryProject,
  type SitesSnapshot,
} from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import * as Schema from "effect/Schema";
import { ChevronRightIcon, LockIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Dialog } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { toastManager } from "~/components/ui/toast";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import {
  WizardFooter,
  WizardHeader,
  WizardPanel,
  WizardPopup,
  WizardSteps,
} from "~/components/ui/wizard";
import { ensureLocalApi } from "~/localApi";
import { cn } from "~/lib/utils";
import { useAtomCommand } from "~/state/use-atom-command";
import { LibraryDialog } from "../project-library/LibraryControls";
import { useUnsavedChangesGuard } from "../project-library/LibraryEditor";
import { ProjectTile } from "../project-library/ProjectIdentity";
import { useLibraryPermission, useLibraryProjects } from "../project-library/state";
import { SERVICE_KINDS, SiteMark, siteHost, sitePath, type ActiveToggleTarget } from "./SiteHealth";
import { sites } from "./state";

type Site = SitesSnapshot["sites"][number];
type Service = SitesSnapshot["services"][number];
type Check = SitesSnapshot["checks"][number];
type ServiceKind = Service["kind"];

export const SITE_WIZARD_STEPS = ["address", "serves", "monitoring"] as const;
export type SiteWizardStep = (typeof SITE_WIZARD_STEPS)[number];
const STEP_LABELS: Record<SiteWizardStep, string> = {
  address: "Address",
  serves: "What it serves",
  monitoring: "Monitoring",
};

export type SiteEditTarget =
  | {
      kind: "site";
      row?: Site;
      /** Opens the wizard on this step, such as "serves" from a site missing its projects. */
      step?: SiteWizardStep;
      /** Preselects the project a new site serves, when registering from that project. */
      projectId?: string;
    }
  | { kind: "service"; row?: Service }
  | { kind: "check"; row?: Check; serviceId?: string };

const decodeSaveSiteRequest = Schema.decodeUnknownSync(SaveSiteRequest);
const decodeSaveSiteServiceRequest = Schema.decodeUnknownSync(SaveSiteServiceRequest);
const decodeSaveSiteCheckRequest = Schema.decodeUnknownSync(SaveSiteCheckRequest);
const isSiteId = Schema.is(SiteId);

const MAX_ID_LENGTH = 64;
const MAX_NAME_LENGTH = 120;
const MAX_CONTENT_LENGTH = 120;
/** The API's cap on a site's projects, services and analytics origins alike. */
const MAX_LINKS = 20;
/** Past this many projects the list gets a filter, so a long catalog stays one short scan. */
const PROJECT_FILTER_THRESHOLD = 8;
const SERVICE_KIND_ORDER = ["website", "api", "redirect"] as const;
const COMMON_STATUSES = ["200", "204", "301", "302", "304"] as const;
const OTHER_STATUS = "other";

/** The ID a new entry would get from its name; the person can still change it before saving. */
export function idFromName(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_ID_LENGTH)
    .replace(/-+$/, "");
}

/** `base`, or `base-2`, `base-3`... when an entry already holds it, kept within the ID limit. */
export function uniqueId(base: string, taken: ReadonlySet<string>) {
  const root = base || "site";
  if (!taken.has(root)) return root;
  for (let attempt = 2; ; attempt += 1) {
    const suffix = `-${attempt}`;
    const candidate = `${root.slice(0, MAX_ID_LENGTH - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export type AddressReading =
  | {
      readonly ok: true;
      readonly origin: string;
      /** The part of what was typed past the origin, which a site never keeps. */
      readonly droppedPath: string | null;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * What a typed address means as a site or service origin. People type hosts, paste page URLs and
 * forget the scheme, so this accepts all three and says plainly what it will not take.
 */
export function readSiteAddress(input: string): AddressReading {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, reason: "Enter the address people visit." };
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, reason: "That isn't a web address. Try something like example.com." };
  }
  if (url.protocol === "http:") {
    return { ok: false, reason: "Use the site's HTTPS address. Sites only watches secure ones." };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: "Use an address that starts with https://." };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "Leave sign-in details out of the address." };
  }
  if (!url.hostname.includes(".")) {
    return { ok: false, reason: "Use the full host name, like example.com." };
  }
  const rest = `${url.pathname === "/" ? "" : url.pathname}${url.search}${url.hash}`;
  return { ok: true, origin: url.origin, droppedPath: rest || null };
}

/** A name to start from: the host, without the `www.` nobody says aloud. */
export function suggestedName(origin: string) {
  try {
    return new URL(origin).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** A check's name from the page it requests: "/" is the home page, others take their last part. */
export function checkNameFromPath(path: string) {
  const segment = (path.split(/[?#]/)[0] ?? "").split("/").findLast(Boolean);
  if (!segment) return "Home";
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // A malformed escape reads fine as typed.
  }
  const words = decoded.replace(/[-_.]+/g, " ").trim();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : "Home";
}

export type CheckPathReading =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: string };

/**
 * The URL a check requests: a path on its service's origin. A pasted full URL is fine when it is on
 * that origin, since a check may only ever request its own service.
 */
export function readCheckPath(input: string, serviceOrigin: string): CheckPathReading {
  const trimmed = input.trim();
  const host = siteHost(serviceOrigin);
  let url: URL;
  try {
    url = /^https?:\/\//i.test(trimmed)
      ? new URL(trimmed)
      : new URL(trimmed.startsWith("/") ? trimmed : `/${trimmed}`, serviceOrigin);
  } catch {
    return { ok: false, reason: "That isn't a path. Try something like /health." };
  }
  if (url.origin !== serviceOrigin) {
    return {
      ok: false,
      reason: `Checks on this service stay on ${host}. Choose the service for ${url.host} instead.`,
    };
  }
  return { ok: true, url: `${url.origin}${url.pathname}${url.search}` };
}

function originOf(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** A site as the wizard holds it, with the name and ID already resolved from what was typed. */
export type SiteDraft = {
  readonly address: string;
  readonly name: string;
  readonly id: string;
  readonly projectIds: readonly string[];
  readonly serviceIds: readonly string[];
  /** Register a website service and a home page check for this site's own address. */
  readonly watch: boolean;
  /** Analytics origins besides the site's own, which is always counted. */
  readonly extraOrigins: readonly string[];
  readonly active: boolean;
};

export type SiteAddressIssues = {
  readonly address: string | null;
  readonly name: string | null;
  readonly id: string | null;
};

export function siteAddressIssues(
  draft: Pick<SiteDraft, "address" | "name" | "id">,
  /** IDs already used by other sites; null when editing, where the ID is fixed. */
  takenIds: ReadonlySet<string> | null,
): SiteAddressIssues {
  const address = readSiteAddress(draft.address);
  return {
    address: address.ok ? null : address.reason,
    name: nameIssue(draft.name),
    id: idIssue(draft.id, takenIds, "site"),
  };
}

function nameIssue(name: string) {
  if (!name.trim()) return "Give it a name.";
  return name.trim().length > MAX_NAME_LENGTH
    ? `Keep the name under ${MAX_NAME_LENGTH} characters.`
    : null;
}

function idIssue(id: string, takenIds: ReadonlySet<string> | null, noun: string) {
  if (!isSiteId(id)) {
    return "Use lowercase letters, numbers and dashes, starting with a letter or number.";
  }
  return takenIds?.has(id) ? `Another ${noun} already uses the ID ${id}.` : null;
}

/** The first thing each wizard step still needs, or null once the step is complete. */
export function siteDraftIssues(
  draft: SiteDraft,
  takenIds: ReadonlySet<string> | null,
): Record<SiteWizardStep, string | null> {
  const fields = siteAddressIssues(draft, takenIds);
  const address = readSiteAddress(draft.address);
  const originCount = address.ok ? siteOrigins(address.origin, draft.extraOrigins).length : 0;
  return {
    address: fields.address ?? fields.name ?? fields.id,
    serves: !draft.projectIds.length
      ? "Choose at least one project this site serves."
      : draft.projectIds.length > MAX_LINKS
        ? `A site can serve up to ${MAX_LINKS} projects.`
        : null,
    monitoring:
      draft.serviceIds.length + (draft.watch ? 1 : 0) > MAX_LINKS
        ? `A site can run on up to ${MAX_LINKS} services.`
        : originCount > MAX_LINKS
          ? `A site can count visits from up to ${MAX_LINKS} addresses.`
          : null,
  };
}

function siteOrigins(origin: string, extras: readonly string[]) {
  return [...new Set([origin, ...extras])];
}

/** The save request for a draft: its own origin always first among the analytics origins. */
export function siteSaveRequest(
  draft: SiteDraft,
  origin: string,
  /** The service registered alongside the site for its own address, when there is one. */
  watchServiceId: string | null,
) {
  return {
    id: draft.id,
    name: draft.name.trim(),
    url: origin,
    active: draft.active,
    origins: siteOrigins(origin, draft.extraOrigins),
    serviceIds: [...new Set([...draft.serviceIds, ...(watchServiceId ? [watchServiceId] : [])])],
    projectIds: [...draft.projectIds],
  };
}

/** Services already serving an origin, which a new site on it most likely runs on. */
export function servicesForOrigin(services: readonly Service[], origin: string) {
  return services.filter((service) => originOf(service.url) === origin);
}

/**
 * A request's identity for a save that may be retried, and the request itself unless that exact
 * one already went through. A retry after an edit sends the edited entry rather than skipping it.
 */
export function unsentRequest<T>(request: T, sent: string | null | undefined) {
  const key = JSON.stringify(request);
  return { key, request: key === sent ? null : request };
}

function sitesStage(cause: unknown) {
  return typeof cause === "object" &&
    cause !== null &&
    "_tag" in cause &&
    cause._tag === "SitesError" &&
    "stage" in cause &&
    typeof cause.stage === "string"
    ? cause.stage
    : null;
}

function failureText(cause: unknown) {
  if (Schema.isSchemaError(cause)) {
    return "Some details don't fit what Sites accepts. Check the address, the name and the ID.";
  }
  return cause instanceof Error && cause.message
    ? cause.message
    : "Could not save. Refresh and try again.";
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

const toggle = (values: readonly string[], value: string) =>
  values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];

type EditorProps = {
  readonly snapshot: SitesSnapshot;
  readonly environmentId: EnvironmentId;
  /** Whether saving can work right now: connected, permitted and configured. */
  readonly connected: boolean;
  /** Why saving cannot work, when the page knows better than "reconnect". */
  readonly blockedReason?: string | null | undefined;
  readonly onSaved: (id: string) => void;
  readonly onClose: () => void;
};

export function SiteEditor({ target, ...props }: EditorProps & { target: SiteEditTarget }) {
  if (target.kind === "site") return <SiteWizard target={target} {...props} />;
  if (target.kind === "service") return <ServiceDialog target={target} {...props} />;
  return <CheckDialog target={target} {...props} />;
}

const DISCARD_MESSAGE = "Discard your changes? Nothing has been saved yet.";

/**
 * Closing keeps a draft from vanishing by accident: Escape and the close button ask first once
 * something was typed, and a click outside the dialog never closes it.
 */
function useDraftClose({
  dirty,
  busy,
  onClose,
}: {
  readonly dirty: boolean;
  readonly busy: boolean;
  readonly onClose: () => void;
}) {
  const guard = useUnsavedChangesGuard({
    dirty,
    message: DISCARD_MESSAGE,
    staysOpen: () => false,
  });
  const requestClose = async () => {
    if (busy) return;
    if (dirty && !(await ensureLocalApi().dialogs.confirm(DISCARD_MESSAGE))) return;
    guard.leave(onClose);
  };
  return { requestClose, leave: guard.leave };
}

function SiteWizard({
  target,
  snapshot,
  environmentId,
  connected,
  blockedReason,
  onSaved,
  onClose,
}: EditorProps & { target: Extract<SiteEditTarget, { kind: "site" }> }) {
  const row = target.row;
  const editing = Boolean(row);
  const [address, setAddress] = useState(row?.url ?? "");
  // Until someone types their own, the name follows the address and the ID follows the name.
  const [nameOverride, setNameOverride] = useState<string | null>(row ? row.name : null);
  const [idOverride, setIdOverride] = useState<string | null>(row ? row.id : null);
  const [projectIds, setProjectIds] = useState<readonly string[]>(
    row?.projectIds ?? (target.projectId ? [target.projectId] : []),
  );
  const [serviceIds, setServiceIds] = useState<readonly string[]>(row?.serviceIds ?? []);
  const [servicesTouched, setServicesTouched] = useState(editing);
  const [watch, setWatch] = useState(!editing);
  const [extraOrigins, setExtraOrigins] = useState<readonly string[]>(
    row ? row.origins.filter((origin) => origin !== originOf(row.url)) : [],
  );
  const [active, setActive] = useState(row ? Boolean(row.active) : true);
  const [step, setStep] = useState(() =>
    Math.max(0, SITE_WIZARD_STEPS.indexOf(target.step ?? "address")),
  );
  const [shown, setShown] = useState<ReadonlySet<SiteWizardStep>>(() => new Set());
  // The favicon loads once the address is settled, never on every key press.
  const [markOrigin, setMarkOrigin] = useState(row ? originOf(row.url) : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What a partly failed save already sent, so trying again sends only what is missing or edited.
  // The IDs stay fixed across tries, so a retry updates those entries instead of adding more.
  const [sent, setSent] = useState<{
    readonly serviceId: string;
    readonly checkId: string;
    readonly service: string | null;
    readonly check: string | null;
  } | null>(null);
  const [dirty, setDirty] = useState(false);
  const formId = useId();
  const catalog = useLibraryProjects(true);
  const allowed = useLibraryPermission(sites.saveSite, environmentId);
  const saveSite = useAtomCommand(sites.saveSite, { reportFailure: false });
  const saveService = useAtomCommand(sites.saveService, { reportFailure: false });
  const saveCheck = useAtomCommand(sites.saveCheck, { reportFailure: false });
  const { requestClose, leave } = useDraftClose({ dirty, busy, onClose });

  const reading = readSiteAddress(address);
  const origin = reading.ok ? reading.origin : null;
  const takenSiteIds = editing ? null : new Set(snapshot.sites.map((site) => site.id));
  const name = nameOverride ?? (origin ? suggestedName(origin) : "");
  const id = idOverride ?? uniqueId(idFromName(name), takenSiteIds ?? new Set());
  const matching = origin ? servicesForOrigin(snapshot.services, origin) : [];
  const watchable = origin !== null && !matching.length;
  const draft: SiteDraft = {
    address,
    name,
    id,
    projectIds,
    serviceIds,
    watch: watchable && watch,
    extraOrigins,
    active,
  };
  const issues = siteDraftIssues(draft, takenSiteIds);
  const fieldIssues = siteAddressIssues(draft, takenSiteIds);
  const current = SITE_WIZARD_STEPS[step] ?? "address";
  const canSave = connected && allowed && !busy;
  const edited = <T,>(set: (value: T) => void) => {
    return (value: T) => {
      setDirty(true);
      setError(null);
      set(value);
    };
  };

  const goTo = (next: number) => {
    // Leaving the address for the first time, a new site picks up the services already on it.
    if (step === 0 && next > 0 && !servicesTouched && origin) {
      setServiceIds((ids) => [...new Set([...ids, ...matching.map((service) => service.id)])]);
      setServicesTouched(true);
    }
    if (origin) setMarkOrigin(origin);
    setStep(next);
  };
  const reveal = (blocked: SiteWizardStep) => {
    setShown((steps) => new Set([...steps, blocked]));
    setStep(SITE_WIZARD_STEPS.indexOf(blocked));
  };
  const firstIssueBefore = (index: number) =>
    SITE_WIZARD_STEPS.slice(0, index).find((entry) => issues[entry] !== null) ?? null;
  const next = () => {
    if (issues[current]) {
      reveal(current);
      return;
    }
    goTo(step + 1);
  };

  const submit = async () => {
    if (!canSave || !origin) {
      if (!origin) reveal("address");
      return;
    }
    const blocked = SITE_WIZARD_STEPS.find((entry) => issues[entry] !== null);
    if (blocked) {
      reveal(blocked);
      return;
    }
    setBusy(true);
    setError(null);
    let progress = sent;
    // Async so a synchronous decode failure reaches the same handler as a failed save.
    await (async () => {
      if (draft.watch) {
        const serviceId =
          progress?.serviceId ??
          uniqueId(
            idFromName(suggestedName(origin)),
            new Set(snapshot.services.map((service) => service.id)),
          );
        const checkId =
          progress?.checkId ??
          uniqueId(
            `${serviceId}-home`.slice(0, MAX_ID_LENGTH),
            new Set(snapshot.checks.map((check) => check.id)),
          );
        progress = progress ?? { serviceId, checkId, service: null, check: null };
        const service = unsentRequest(
          decodeSaveSiteServiceRequest({
            id: serviceId,
            name: name.trim(),
            url: origin,
            active: true,
            kind: "website",
          }),
          progress.service,
        );
        if (service.request) {
          const result = await saveService({ environmentId, input: service.request });
          if (result._tag === "Failure") throw squashAtomCommandFailure(result);
          progress = { ...progress, service: service.key };
          setSent(progress);
        }
        const check = unsentRequest(
          decodeSaveSiteCheckRequest({
            id: checkId,
            name: "Home",
            url: `${origin}/`,
            active: true,
            service_id: serviceId,
            expected_status: 200,
            content: "",
          }),
          progress.check,
        );
        if (check.request) {
          const result = await saveCheck({ environmentId, input: check.request });
          if (result._tag === "Failure") throw squashAtomCommandFailure(result);
          progress = { ...progress, check: check.key };
          setSent(progress);
        }
      }
      const result = await saveSite({
        environmentId,
        input: decodeSaveSiteRequest(
          siteSaveRequest(draft, origin, draft.watch ? (progress?.serviceId ?? null) : null),
        ),
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      leave(() => onSaved(draft.id));
    })()
      .catch((cause) => {
        const text = failureText(cause);
        setError(
          progress?.service
            ? `The ${siteHost(origin)} service${progress.check ? " and its home page check are" : " is"} registered, but the site is not yet. ${text}`
            : text,
        );
        if (sitesStage(cause) === "project") setStep(SITE_WIZARD_STEPS.indexOf("serves"));
      })
      .finally(() => setBusy(false));
  };

  const last = step === SITE_WIZARD_STEPS.length - 1;
  const projectCount = projectIds.length;
  const serviceCount = serviceIds.length + (draft.watch ? 1 : 0);
  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open) void requestClose();
      }}
    >
      <WizardPopup>
        <WizardHeader
          title={row ? `Edit ${row.name}` : "Register a site"}
          description={
            row
              ? "Change where the site lives, what it serves and how Loom watches it."
              : "Tell Loom where the site lives and what it serves. Loom watches it and counts its visits."
          }
        >
          <div className="pt-3">
            <WizardSteps
              steps={SITE_WIZARD_STEPS.map((entry) => STEP_LABELS[entry])}
              currentStep={step}
              summaries={[
                origin ? siteHost(origin) : null,
                projectCount ? plural(projectCount, "project") : null,
                serviceCount ? plural(serviceCount, "service") : null,
              ]}
              onStepChange={(index) => {
                const blocked = index > step ? firstIssueBefore(index) : null;
                if (blocked) reveal(blocked);
                else goTo(index);
              }}
              isStepDisabled={(index) => !editing && index > step + 1}
            />
          </div>
        </WizardHeader>
        <WizardPanel>
          <form
            id={formId}
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (editing || last) void submit();
              else next();
            }}
          >
            <fieldset disabled={busy} className="flex min-w-0 flex-col gap-5">
              {current === "address" ? (
                <AddressStep
                  address={address}
                  reading={reading}
                  name={name}
                  id={id}
                  editing={editing}
                  markOrigin={markOrigin}
                  issues={shown.has("address") ? fieldIssues : null}
                  onAddress={edited(setAddress)}
                  onSettle={() => {
                    if (origin) setMarkOrigin(origin);
                  }}
                  onName={edited(setNameOverride)}
                  onId={edited(setIdOverride)}
                />
              ) : current === "serves" ? (
                <ServesStep
                  projects={catalog.query}
                  selected={projectIds}
                  issue={shown.has("serves") ? issues.serves : null}
                  onToggle={edited((projectId: string) =>
                    setProjectIds(toggle(projectIds, projectId)),
                  )}
                />
              ) : (
                <MonitoringStep
                  snapshot={snapshot}
                  origin={origin}
                  matching={matching}
                  serviceIds={serviceIds}
                  watch={draft.watch}
                  watchable={watchable}
                  extraOrigins={extraOrigins}
                  active={active}
                  issue={shown.has("monitoring") ? issues.monitoring : null}
                  onToggleService={edited((serviceId: string) => {
                    setServicesTouched(true);
                    setServiceIds(toggle(serviceIds, serviceId));
                  })}
                  onWatch={edited(setWatch)}
                  onOrigins={edited(setExtraOrigins)}
                  onActive={edited(setActive)}
                />
              )}
            </fieldset>
          </form>
          {error ? (
            <p role="alert" className="mt-4 text-sm text-destructive-foreground">
              {error}
            </p>
          ) : null}
        </WizardPanel>
        <WizardFooter
          leading={
            <Button
              shape="pill"
              variant="ghost"
              disabled={busy}
              onClick={() => void requestClose()}
            >
              Cancel
            </Button>
          }
        >
          {step > 0 && !editing ? (
            <Button shape="pill" variant="outline" disabled={busy} onClick={() => goTo(step - 1)}>
              Back
            </Button>
          ) : null}
          {/* One button for Next and Register, so pressing Next into the last step keeps focus
              on it instead of dropping it with a swapped element. */}
          {editing || last ? (
            <SaveButton
              form={formId}
              canSave={canSave}
              connected={connected}
              allowed={allowed}
              reason={blockedReason}
            >
              {busy ? "Saving…" : editing ? "Save changes" : "Register site"}
            </SaveButton>
          ) : (
            <SaveButton form={formId} canSave connected allowed reason={null}>
              Next
            </SaveButton>
          )}
        </WizardFooter>
      </WizardPopup>
    </Dialog>
  );
}

function SaveButton({
  form,
  canSave,
  connected,
  allowed,
  reason,
  children,
}: {
  readonly form: string;
  readonly canSave: boolean;
  readonly connected: boolean;
  readonly allowed: boolean;
  readonly reason: string | null | undefined;
  readonly children: ReactNode;
}) {
  const button = (
    <Button shape="pill" type="submit" form={form} disabled={!canSave}>
      {children}
    </Button>
  );
  if (connected && allowed) return button;
  return (
    <span className="inline-flex flex-col items-end gap-1">
      {button}
      <span className="text-xs text-muted-foreground">
        {!allowed
          ? "You need settings access to save."
          : (reason ?? "Reconnect your Library to save.")}
      </span>
    </span>
  );
}

function AddressStep({
  address,
  reading,
  name,
  id,
  editing,
  markOrigin,
  issues,
  onAddress,
  onSettle,
  onName,
  onId,
}: {
  readonly address: string;
  readonly reading: AddressReading;
  readonly name: string;
  readonly id: string;
  readonly editing: boolean;
  readonly markOrigin: string | null;
  /** Shown once someone tried to move on, so a half-typed address is not called wrong. */
  readonly issues: SiteAddressIssues | null;
  readonly onAddress: (value: string) => void;
  readonly onSettle: () => void;
  readonly onName: (value: string) => void;
  readonly onId: (value: string) => void;
}) {
  const host = reading.ok ? siteHost(reading.origin) : null;
  return (
    <>
      <Field
        label="Address"
        issue={issues?.address ?? null}
        hint={
          reading.ok && reading.droppedPath
            ? `Loom watches all of ${host}, so ${reading.droppedPath} is left out. Add a check for that page under Monitoring.`
            : "The HTTPS address people visit, like example.com."
        }
      >
        {(describedBy) => (
          <InputGroup>
            <InputGroupAddon>
              {markOrigin && reading.ok && markOrigin === reading.origin ? (
                <SiteMark url={markOrigin} />
              ) : (
                <span className="font-mono text-xs text-muted-foreground">https://</span>
              )}
            </InputGroupAddon>
            <InputGroupInput
              autoFocus
              value={address.replace(/^https:\/\//i, "")}
              onChange={(event) => onAddress(event.target.value)}
              onBlur={onSettle}
              placeholder="example.com"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              font="mono"
              aria-invalid={issues?.address ? true : undefined}
              aria-describedby={describedBy}
            />
          </InputGroup>
        )}
      </Field>
      <Field
        label="Name"
        issue={issues?.name ?? null}
        hint="How the site reads across Loom. It starts as the host name."
      >
        {(describedBy) => (
          <Input
            value={name}
            maxLength={MAX_NAME_LENGTH}
            onChange={(event) => onName(event.target.value)}
            aria-invalid={issues?.name ? true : undefined}
            aria-describedby={describedBy}
          />
        )}
      </Field>
      <Advanced open={Boolean(issues?.id)}>
        <Field
          label="ID"
          issue={issues?.id ?? null}
          hint={
            editing
              ? "The ID keeps this site's history together, so it stays fixed."
              : "Lowercase letters, numbers and dashes. It can't change after saving."
          }
        >
          {(describedBy) => (
            <Input
              value={id}
              font="mono"
              maxLength={MAX_ID_LENGTH}
              readOnly={editing}
              onChange={(event) => onId(event.target.value)}
              aria-invalid={issues?.id ? true : undefined}
              aria-describedby={describedBy}
            />
          )}
        </Field>
      </Advanced>
    </>
  );
}

function ServesStep({
  projects,
  selected,
  issue,
  onToggle,
}: {
  readonly projects: {
    readonly data: readonly LibraryProject[] | null;
    readonly error: string | null;
    readonly isPending: boolean;
    readonly refresh: () => void;
  };
  readonly selected: readonly string[];
  readonly issue: string | null;
  readonly onToggle: (projectId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const catalog = (projects.data ?? []).toSorted((a, b) => Number(a.archived) - Number(b.archived));
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? catalog.filter((project) => project.title.toLowerCase().includes(needle))
    : catalog;
  const missing = projects.data
    ? selected.filter((projectId) => !catalog.some((project) => project.id === projectId))
    : [];
  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="mb-1 text-sm font-medium">Projects this site serves</legend>
      <p className="-mt-1 text-xs text-muted-foreground">
        At least one. The site takes the color of the first project you choose.
      </p>
      {catalog.length > PROJECT_FILTER_THRESHOLD ? (
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter projects"
            aria-label="Filter projects"
            size="sm"
          />
        </InputGroup>
      ) : null}
      {projects.isPending && !projects.data ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading projects…
        </p>
      ) : null}
      {projects.error ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-destructive-foreground">{projects.error}</span>
          <Button shape="pill" size="xs" variant="outline" onClick={projects.refresh}>
            Try again
          </Button>
        </div>
      ) : null}
      {projects.data && !catalog.length ? (
        <p className="text-sm text-muted-foreground">
          This Library has no projects yet. Create one in Projects, then register the site.
        </p>
      ) : null}
      {catalog.length ? (
        <div className="flex flex-col gap-0.5">
          {shown.map((project) => (
            <Choice
              key={project.id}
              control={
                <Checkbox
                  checked={selected.includes(project.id)}
                  onCheckedChange={() => onToggle(project.id)}
                />
              }
              leading={<ProjectTile project={project} size="sm" />}
              title={project.title}
              detail={project.archived ? "Archived" : undefined}
            />
          ))}
          {needle && !shown.length ? (
            <p className="px-2.5 py-2 text-sm text-muted-foreground">No projects match.</p>
          ) : null}
        </div>
      ) : null}
      {missing.map((projectId) => (
        <div
          key={projectId}
          className="flex min-w-0 items-center gap-3 rounded-lg bg-warning/10 px-2.5 py-2"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-warning-foreground">Unavailable project</span>
            <span className="block truncate font-mono text-2xs text-muted-foreground">
              {projectId}
            </span>
          </span>
          <Button shape="pill" size="xs" variant="ghost" onClick={() => onToggle(projectId)}>
            Remove
          </Button>
        </div>
      ))}
      {issue ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {issue}
        </p>
      ) : null}
    </fieldset>
  );
}

function MonitoringStep({
  snapshot,
  origin,
  matching,
  serviceIds,
  watch,
  watchable,
  extraOrigins,
  active,
  issue,
  onToggleService,
  onWatch,
  onOrigins,
  onActive,
}: {
  readonly snapshot: SitesSnapshot;
  readonly origin: string | null;
  readonly matching: readonly Service[];
  readonly serviceIds: readonly string[];
  readonly watch: boolean;
  /** No service serves the site's own address yet, so the wizard can register one. */
  readonly watchable: boolean;
  readonly extraOrigins: readonly string[];
  readonly active: boolean;
  readonly issue: string | null;
  readonly onToggleService: (serviceId: string) => void;
  readonly onWatch: (watch: boolean) => void;
  readonly onOrigins: (origins: readonly string[]) => void;
  readonly onActive: (active: boolean) => void;
}) {
  const host = origin ? siteHost(origin) : "this address";
  const services = [
    ...matching,
    ...snapshot.services.filter((service) => !matching.includes(service)),
  ];
  return (
    <>
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Runs on</legend>
        <p className="-mt-0.5 mb-1 text-xs text-muted-foreground">
          The services this site depends on. A failing check on any of them marks the site failing.
        </p>
        {watchable ? (
          <Choice
            control={<Checkbox checked={watch} onCheckedChange={(checked) => onWatch(checked)} />}
            leading={<KindTile kind="website" />}
            title={`Watch ${host}`}
            detail={`Registers it as a website and checks that ${host}/ answers 200.`}
          />
        ) : null}
        {services.length ? (
          <div className="flex flex-col gap-0.5">
            {services.map((service) => (
              <Choice
                key={service.id}
                control={
                  <Checkbox
                    checked={serviceIds.includes(service.id)}
                    onCheckedChange={() => onToggleService(service.id)}
                  />
                }
                leading={<KindTile kind={service.kind} />}
                title={service.name}
                detail={`${siteHost(service.url)}${matching.includes(service) ? " · this site's address" : ""}${service.active ? "" : " · paused"}`}
                mono
              />
            ))}
          </div>
        ) : watchable ? null : (
          <p className="text-sm text-muted-foreground">
            No services yet. Register them under Services, then link them here.
          </p>
        )}
      </fieldset>
      <OriginsField origin={origin} extras={extraOrigins} onChange={onOrigins} />
      <label className="flex items-center justify-between gap-4 rounded-xl bg-muted/50 px-3.5 py-3 dark:bg-accent/50">
        <span className="min-w-0">
          <span className="block text-sm font-medium">Watch this site</span>
          <span className="block text-xs text-muted-foreground">
            Sites are never deleted, so pause one you no longer need. It keeps its history and
            traffic.
          </span>
        </span>
        <Switch checked={active} onCheckedChange={onActive} />
      </label>
      {issue ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {issue}
        </p>
      ) : null}
    </>
  );
}

function KindTile({ kind }: { readonly kind: ServiceKind }) {
  const Icon = SERVICE_KINDS[kind].icon;
  return (
    <span
      aria-hidden
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground dark:bg-accent"
    >
      <Icon className="size-3.5" />
    </span>
  );
}

/** Where visits are counted from. The site's own address is always one of them. */
function OriginsField({
  origin,
  extras,
  onChange,
}: {
  readonly origin: string | null;
  readonly extras: readonly string[];
  readonly onChange: (origins: readonly string[]) => void;
}) {
  const [value, setValue] = useState("");
  const [issue, setIssue] = useState<string | null>(null);
  const inputId = useId();
  const add = () => {
    const reading = readSiteAddress(value);
    if (!reading.ok) {
      setIssue(reading.reason);
      return;
    }
    if (reading.origin === origin || extras.includes(reading.origin)) {
      setIssue(`${siteHost(reading.origin)} is already counted.`);
      return;
    }
    onChange([...extras, reading.origin]);
    setValue("");
    setIssue(null);
  };
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={inputId} className="text-sm font-medium">
        Counts visits from
      </label>
      <p className="-mt-1 text-xs text-muted-foreground">
        Visits from anywhere else are not counted, such as a preview deployment.
      </p>
      <ul className="flex flex-wrap gap-1.5" aria-label="Counted addresses">
        {origin ? (
          <li className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-full bg-muted px-2.5 font-mono text-2xs text-foreground/80 dark:bg-accent">
            <LockIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate">{siteHost(origin)}</span>
            <span className="sr-only">, always counted</span>
          </li>
        ) : null}
        {extras.map((entry) => (
          <li key={entry}>
            <Button
              shape="pill"
              size="xs"
              variant="secondary"
              aria-label={`Stop counting visits from ${siteHost(entry)}`}
              onClick={() => onChange(extras.filter((other) => other !== entry))}
            >
              <span className="font-mono">{siteHost(entry)}</span>
              <XIcon aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex min-w-0 items-center gap-1.5">
        <Input
          id={inputId}
          size="sm"
          font="mono"
          value={value}
          placeholder="www.example.com"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={issue ? true : undefined}
          onChange={(event) => {
            setValue(event.target.value);
            setIssue(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button shape="pill" size="sm" variant="outline" disabled={!value.trim()} onClick={add}>
          <PlusIcon />
          Add
        </Button>
      </div>
      {issue ? (
        <p role="alert" className="text-xs text-destructive-foreground">
          {issue}
        </p>
      ) : null}
    </div>
  );
}

function ServiceDialog({
  target,
  snapshot,
  environmentId,
  connected,
  blockedReason,
  onSaved,
  onClose,
}: EditorProps & { target: Extract<SiteEditTarget, { kind: "service" }> }) {
  const row = target.row;
  const editing = Boolean(row);
  const [address, setAddress] = useState(row?.url ?? "");
  const [nameOverride, setNameOverride] = useState<string | null>(row ? row.name : null);
  const [idOverride, setIdOverride] = useState<string | null>(row ? row.id : null);
  const [kindOverride, setKindOverride] = useState<ServiceKind | null>(row ? row.kind : null);
  const [active, setActive] = useState(row ? Boolean(row.active) : true);
  const [addCheckOverride, setAddCheckOverride] = useState<boolean | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The service request a partly failed save already sent, so a retry skips it only if unedited.
  const [sentService, setSentService] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const formId = useId();
  const allowed = useLibraryPermission(sites.saveService, environmentId);
  const saveService = useAtomCommand(sites.saveService, { reportFailure: false });
  const saveCheck = useAtomCommand(sites.saveCheck, { reportFailure: false });
  const { requestClose, leave } = useDraftClose({ dirty, busy, onClose });

  const reading = readSiteAddress(address);
  const origin = reading.ok ? reading.origin : null;
  const host = origin ? siteHost(origin) : null;
  const takenIds = editing ? null : new Set(snapshot.services.map((service) => service.id));
  const name = nameOverride ?? (origin ? suggestedName(origin) : "");
  const id = idOverride ?? uniqueId(idFromName(name), takenIds ?? new Set());
  // An `api.` host is almost always an API; anything else starts as a website.
  const kind = kindOverride ?? (host?.startsWith("api.") ? "api" : "website");
  const homeStatus = kind === "redirect" ? 301 : 200;
  const addCheck = !editing && (addCheckOverride ?? kind !== "api");
  const issues = {
    address: reading.ok ? null : reading.reason,
    name: nameIssue(name),
    id: idIssue(id, takenIds, "service"),
  };
  const shownIssues = attempted ? issues : null;
  const canSave = connected && allowed && !busy;
  const edited = <T,>(set: (value: T) => void) => {
    return (value: T) => {
      setDirty(true);
      setError(null);
      set(value);
    };
  };

  const submit = async () => {
    setAttempted(true);
    if (!canSave || !origin || issues.name || issues.id) return;
    setBusy(true);
    setError(null);
    let serviceSaved = false;
    // Async so a synchronous decode failure reaches the same handler as a failed save.
    await (async () => {
      const service = unsentRequest(
        decodeSaveSiteServiceRequest({ id, name: name.trim(), url: origin, active, kind }),
        sentService,
      );
      if (service.request) {
        const result = await saveService({ environmentId, input: service.request });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        setSentService(service.key);
        // Pinned, so a name edited before the retry updates this service rather than adding one.
        setIdOverride(id);
      }
      serviceSaved = true;
      if (addCheck) {
        const result = await saveCheck({
          environmentId,
          input: decodeSaveSiteCheckRequest({
            id: uniqueId(
              `${id}-home`.slice(0, MAX_ID_LENGTH),
              new Set(snapshot.checks.map((check) => check.id)),
            ),
            name: "Home",
            url: `${origin}/`,
            active: true,
            service_id: id,
            expected_status: homeStatus,
            content: "",
          }),
        });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      }
      leave(() => onSaved(id));
    })()
      .catch((cause) => {
        const text = failureText(cause);
        setError(serviceSaved ? `The service is registered, but its check is not. ${text}` : text);
      })
      .finally(() => setBusy(false));
  };

  return (
    <LibraryDialog
      open
      onOpenChange={(open) => {
        if (!open) void requestClose();
      }}
      title={row ? `Edit ${row.name}` : "Register a service"}
      description="A service is an address your sites depend on, like the site itself or the API behind it. Several sites can share one."
      actions={
        <>
          <Button
            shape="pill"
            variant="outline"
            disabled={busy}
            onClick={() => void requestClose()}
          >
            Cancel
          </Button>
          <SaveButton
            form={formId}
            canSave={canSave}
            connected={connected}
            allowed={allowed}
            reason={blockedReason}
          >
            {busy
              ? "Saving…"
              : editing
                ? "Save changes"
                : addCheck
                  ? "Register and check"
                  : "Register service"}
          </SaveButton>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <fieldset disabled={busy} className="flex min-w-0 flex-col gap-5">
          <Field
            label="Address"
            issue={shownIssues?.address ?? null}
            hint={
              reading.ok && reading.droppedPath
                ? `A service is a whole origin, so ${reading.droppedPath} is left out. Add a check for that path afterwards.`
                : "The HTTPS origin it answers on, like api.example.com."
            }
          >
            {(describedBy) => (
              <InputGroup>
                <InputGroupAddon>
                  <span className="font-mono text-xs text-muted-foreground">https://</span>
                </InputGroupAddon>
                <InputGroupInput
                  autoFocus={!editing}
                  value={address.replace(/^https:\/\//i, "")}
                  onChange={(event) => edited(setAddress)(event.target.value)}
                  placeholder="api.example.com"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  font="mono"
                  aria-invalid={shownIssues?.address ? true : undefined}
                  aria-describedby={describedBy}
                />
              </InputGroup>
            )}
          </Field>
          <Field label="Name" issue={shownIssues?.name ?? null}>
            {(describedBy) => (
              <Input
                value={name}
                maxLength={MAX_NAME_LENGTH}
                onChange={(event) => edited(setNameOverride)(event.target.value)}
                aria-invalid={shownIssues?.name ? true : undefined}
                aria-describedby={describedBy}
              />
            )}
          </Field>
          <KindField kind={kind} onChange={edited(setKindOverride)} />
          {editing ? null : (
            <Choice
              control={
                <Checkbox
                  checked={addCheck}
                  onCheckedChange={(checked) => edited(setAddCheckOverride)(checked)}
                />
              }
              title="Check its home page"
              detail={`Loom requests ${host ?? "the address"}/ on a schedule and expects ${homeStatus}.`}
            />
          )}
          <Advanced open={Boolean(shownIssues?.id)}>
            <Field
              label="ID"
              issue={shownIssues?.id ?? null}
              hint={
                editing
                  ? "The ID keeps this service's checks together, so it stays fixed."
                  : "Lowercase letters, numbers and dashes. It can't change after saving."
              }
            >
              {(describedBy) => (
                <Input
                  value={id}
                  font="mono"
                  maxLength={MAX_ID_LENGTH}
                  // Once the service is registered, a new ID would register a second one.
                  readOnly={editing || sentService !== null}
                  onChange={(event) => edited(setIdOverride)(event.target.value)}
                  aria-invalid={shownIssues?.id ? true : undefined}
                  aria-describedby={describedBy}
                />
              )}
            </Field>
          </Advanced>
          <label className="flex items-center justify-between gap-4 rounded-xl bg-muted/50 px-3.5 py-3 dark:bg-accent/50">
            <span className="min-w-0">
              <span className="block text-sm font-medium">Watch this service</span>
              <span className="block text-xs text-muted-foreground">
                Services are never deleted. Pausing stops its checks and keeps their history.
              </span>
            </span>
            <Switch checked={active} onCheckedChange={edited(setActive)} />
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

function KindField({
  kind,
  onChange,
}: {
  readonly kind: ServiceKind;
  readonly onChange: (kind: ServiceKind) => void;
}) {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-2">
      <p id={labelId} className="text-sm font-medium">
        Kind
      </p>
      <ToggleGroup
        shape="pill"
        variant="segmented"
        aria-labelledby={labelId}
        value={[kind]}
        onValueChange={(value) => {
          const next = SERVICE_KIND_ORDER.find((entry) => entry === value[0]);
          if (next) onChange(next);
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
  );
}

function CheckDialog({
  target,
  snapshot,
  environmentId,
  connected,
  blockedReason,
  onSaved,
  onClose,
}: EditorProps & { target: Extract<SiteEditTarget, { kind: "check" }> }) {
  const row = target.row;
  const editing = Boolean(row);
  const services = snapshot.services;
  const [serviceId, setServiceId] = useState(
    row?.service_id ?? target.serviceId ?? services[0]?.id ?? "",
  );
  const [path, setPath] = useState(row ? sitePath(row.url) : "/");
  const [nameOverride, setNameOverride] = useState<string | null>(row ? row.name : null);
  const [idOverride, setIdOverride] = useState<string | null>(row ? row.id : null);
  const initialStatus = String(row?.expected_status ?? 200);
  const [status, setStatus] = useState(initialStatus);
  const [customStatus, setCustomStatus] = useState(
    !COMMON_STATUSES.some((entry) => entry === initialStatus),
  );
  const [content, setContent] = useState(row?.content ?? "");
  const [active, setActive] = useState(row ? Boolean(row.active) : true);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const formId = useId();
  const statusId = useId();
  const allowed = useLibraryPermission(sites.saveCheck, environmentId);
  const saveCheck = useAtomCommand(sites.saveCheck, { reportFailure: false });
  const { requestClose, leave } = useDraftClose({ dirty, busy, onClose });

  const service = services.find((entry) => entry.id === serviceId) ?? null;
  const serviceOrigin = service ? originOf(service.url) : null;
  const reading = serviceOrigin ? readCheckPath(path, serviceOrigin) : null;
  const takenIds = editing ? null : new Set(snapshot.checks.map((check) => check.id));
  const name = nameOverride ?? checkNameFromPath(path);
  const id =
    idOverride ??
    uniqueId(
      `${serviceId}-${idFromName(path) || "home"}`.slice(0, MAX_ID_LENGTH).replace(/-+$/, ""),
      takenIds ?? new Set(),
    );
  const expected = Number(status);
  const issues = {
    service: service ? null : "Choose the service this check requests.",
    path: reading && !reading.ok ? reading.reason : null,
    name: nameIssue(name),
    id: idIssue(id, takenIds, "check"),
    status:
      Number.isInteger(expected) && expected >= 200 && expected <= 399
        ? null
        : "Expect a status from 200 to 399. Redirects are not followed.",
  };
  const shownIssues = attempted ? issues : null;
  const canSave = connected && allowed && !busy;
  const edited = <T,>(set: (value: T) => void) => {
    return (value: T) => {
      setDirty(true);
      setError(null);
      set(value);
    };
  };

  const submit = async () => {
    setAttempted(true);
    if (!canSave || !reading?.ok || Object.values(issues).some(Boolean)) return;
    setBusy(true);
    setError(null);
    // Async so a synchronous decode failure reaches the same handler as a failed save.
    await (async () => {
      const result = await saveCheck({
        environmentId,
        input: decodeSaveSiteCheckRequest({
          id,
          name: name.trim(),
          url: reading.url,
          active,
          service_id: serviceId,
          expected_status: expected,
          content: content.trim(),
        }),
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      leave(() => onSaved(id));
    })()
      .catch((cause) => {
        setError(failureText(cause));
      })
      .finally(() => setBusy(false));
  };

  return (
    <LibraryDialog
      open
      onOpenChange={(open) => {
        if (!open) void requestClose();
      }}
      title={row ? `Edit ${row.name}` : "Add a check"}
      description="Loom requests this page on a schedule and tells you when the answer changes."
      actions={
        <>
          <Button
            shape="pill"
            variant="outline"
            disabled={busy}
            onClick={() => void requestClose()}
          >
            Cancel
          </Button>
          <SaveButton
            form={formId}
            canSave={canSave}
            connected={connected}
            allowed={allowed}
            reason={blockedReason}
          >
            {busy ? "Saving…" : editing ? "Save changes" : "Add check"}
          </SaveButton>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <fieldset disabled={busy} className="flex min-w-0 flex-col gap-5">
          {services.length ? (
            <Field label="Service" issue={shownIssues?.service ?? null}>
              {() => (
                <Select
                  value={serviceId}
                  onValueChange={(next) => {
                    if (typeof next === "string") edited(setServiceId)(next);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue>
                      {service ? (
                        <span className="flex min-w-0 items-center gap-2">
                          <ServiceKindIcon kind={service.kind} />
                          <span className="truncate">{service.name}</span>
                          <span className="truncate font-mono text-xs text-muted-foreground">
                            {siteHost(service.url)}
                          </span>
                        </span>
                      ) : (
                        "Choose a service"
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {services.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id} label={entry.name}>
                        <span className="flex min-w-0 items-center gap-2">
                          <ServiceKindIcon kind={entry.kind} />
                          <span className="truncate">{entry.name}</span>
                          <span className="truncate font-mono text-xs text-muted-foreground">
                            {siteHost(entry.url)}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              )}
            </Field>
          ) : (
            <p role="alert" className="text-sm text-muted-foreground">
              Register a service first. A check always requests a page on one of your services.
            </p>
          )}
          <Field
            label="Page"
            issue={shownIssues?.path ?? null}
            hint="The path to request. Redirects are not followed, so use the page's final address."
          >
            {(describedBy) => (
              <InputGroup>
                <InputGroupAddon>
                  <span className="max-w-40 truncate font-mono text-xs text-muted-foreground">
                    {serviceOrigin ? siteHost(serviceOrigin) : "service"}
                  </span>
                </InputGroupAddon>
                <InputGroupInput
                  autoFocus={!editing}
                  value={path}
                  onChange={(event) => edited(setPath)(event.target.value)}
                  placeholder="/health"
                  autoComplete="off"
                  spellCheck={false}
                  font="mono"
                  aria-invalid={shownIssues?.path ? true : undefined}
                  aria-describedby={describedBy}
                />
              </InputGroup>
            )}
          </Field>
          <Field label="Name" issue={shownIssues?.name ?? null}>
            {(describedBy) => (
              <Input
                value={name}
                maxLength={MAX_NAME_LENGTH}
                onChange={(event) => edited(setNameOverride)(event.target.value)}
                aria-invalid={shownIssues?.name ? true : undefined}
                aria-describedby={describedBy}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-2">
              <span id={statusId} className="text-sm font-medium">
                Expected status
              </span>
              <Select
                value={customStatus ? OTHER_STATUS : status}
                onValueChange={(next) => {
                  if (typeof next !== "string") return;
                  setDirty(true);
                  setCustomStatus(next === OTHER_STATUS);
                  if (next !== OTHER_STATUS) setStatus(next);
                }}
              >
                <SelectTrigger aria-labelledby={statusId}>
                  <SelectValue>{customStatus ? "Other" : status}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {COMMON_STATUSES.map((entry) => (
                    <SelectItem key={entry} value={entry} label={entry}>
                      {entry}
                    </SelectItem>
                  ))}
                  <SelectItem value={OTHER_STATUS} label="Other">
                    Other
                  </SelectItem>
                </SelectPopup>
              </Select>
              {customStatus ? (
                <Input
                  type="number"
                  min={200}
                  max={399}
                  value={status}
                  aria-label="Expected status code"
                  aria-invalid={shownIssues?.status ? true : undefined}
                  onChange={(event) => edited(setStatus)(event.target.value)}
                />
              ) : null}
              {shownIssues?.status ? (
                <p role="alert" className="text-xs text-destructive-foreground">
                  {shownIssues.status}
                </p>
              ) : null}
            </div>
            <Field
              label="Expected text"
              hint="Optional. The check fails when the page doesn't contain it."
            >
              {(describedBy) => (
                <Input
                  value={content}
                  maxLength={MAX_CONTENT_LENGTH}
                  placeholder="Welcome"
                  onChange={(event) => edited(setContent)(event.target.value)}
                  aria-describedby={describedBy}
                />
              )}
            </Field>
          </div>
          <Advanced open={Boolean(shownIssues?.id)}>
            <Field
              label="ID"
              issue={shownIssues?.id ?? null}
              hint={
                editing
                  ? "The ID keeps this check's history together, so it stays fixed."
                  : "Lowercase letters, numbers and dashes. It can't change after saving."
              }
            >
              {(describedBy) => (
                <Input
                  value={id}
                  font="mono"
                  maxLength={MAX_ID_LENGTH}
                  readOnly={editing}
                  onChange={(event) => edited(setIdOverride)(event.target.value)}
                  aria-invalid={shownIssues?.id ? true : undefined}
                  aria-describedby={describedBy}
                />
              )}
            </Field>
          </Advanced>
          <label className="flex items-center justify-between gap-4 rounded-xl bg-muted/50 px-3.5 py-3 dark:bg-accent/50">
            <span className="min-w-0">
              <span className="block text-sm font-medium">Check on a schedule</span>
              <span className="block text-xs text-muted-foreground">
                Pausing keeps the check and its history.
              </span>
            </span>
            <Switch checked={active} onCheckedChange={edited(setActive)} />
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

function ServiceKindIcon({ kind }: { readonly kind: ServiceKind }) {
  const Icon = SERVICE_KINDS[kind].icon;
  return <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />;
}

/** A labelled control with a hint under it that turns into the problem once there is one. */
function Field({
  label,
  hint,
  issue = null,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly issue?: string | null;
  /** Renders the control, given the ID of the line that describes it. */
  readonly children: (describedBy: string | undefined) => ReactNode;
}) {
  const noteId = useId();
  const note = issue ?? hint;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {/* The label wraps the control so a click on it focuses the field. */}
      <label className="flex min-w-0 flex-col gap-2">
        <span className="text-sm font-medium">{label}</span>
        {children(note ? noteId : undefined)}
      </label>
      {note ? (
        <p
          id={noteId}
          role={issue ? "alert" : undefined}
          className={cn("text-xs", issue ? "text-destructive-foreground" : "text-muted-foreground")}
        >
          {note}
        </p>
      ) : null}
    </div>
  );
}

/** Settings most people never change, kept out of the way until asked for or needed. */
function Advanced({ open, children }: { readonly open: boolean; readonly children: ReactNode }) {
  return (
    <details open={open || undefined} className="group/advanced min-w-0">
      <summary className="w-fit cursor-pointer list-none rounded-md px-1 py-0.5 text-xs font-medium text-muted-foreground outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-1">
          <ChevronRightIcon
            aria-hidden
            className="size-3.5 transition-transform duration-150 group-open/advanced:rotate-90"
          />
          Advanced
        </span>
      </summary>
      <div className="pt-3">{children}</div>
    </details>
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

/** The save request that replays an entry exactly as it is, apart from whether it is watched. */
export function activeToggleRequest(target: ActiveToggleTarget, active: boolean) {
  switch (target.kind) {
    case "site": {
      const { row } = target;
      return {
        kind: "site" as const,
        input: decodeSaveSiteRequest({
          id: row.id,
          name: row.name,
          url: row.url,
          active,
          origins: row.origins,
          serviceIds: row.serviceIds,
          projectIds: row.projectIds ?? [],
        }),
      };
    }
    case "service": {
      const { row } = target;
      return {
        kind: "service" as const,
        input: decodeSaveSiteServiceRequest({
          id: row.id,
          name: row.name,
          url: row.url,
          active,
          kind: row.kind,
        }),
      };
    }
    case "check": {
      const { row } = target;
      return {
        kind: "check" as const,
        input: decodeSaveSiteCheckRequest({
          id: row.id,
          name: row.name,
          url: row.url,
          active,
          service_id: row.service_id,
          expected_status: row.expected_status ?? 200,
          content: row.content ?? "",
        }),
      };
    }
  }
}

/**
 * Pauses or resumes a site, service or check in one step, outside the editor. Saving replaces
 * the whole entry, so the request replays every field as the snapshot has it. The confirmation
 * offers Undo, since this is a quick action without a dialog in front of it.
 */
export function useSiteActiveToggle({
  environmentId,
  connected,
  onChanged,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly connected: boolean;
  readonly onChanged: () => void;
}) {
  // Per entry, so a second quick toggle never clears the first one's "Saving…".
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const saveSite = useAtomCommand(sites.saveSite, { reportFailure: false });
  const saveService = useAtomCommand(sites.saveService, { reportFailure: false });
  const saveCheck = useAtomCommand(sites.saveCheck, { reportFailure: false });
  const apply = async (target: ActiveToggleTarget, active: boolean): Promise<void> => {
    if (!environmentId || !connected) return;
    const key = `${target.kind}:${target.row.id}`;
    const name = target.row.name;
    setPending((keys) => new Set(keys).add(key));
    // Async so an entry that no longer decodes reaches the same toast as a failed save.
    await (async () => {
      const request = activeToggleRequest(target, active);
      const result =
        request.kind === "site"
          ? await saveSite({ environmentId, input: request.input })
          : request.kind === "service"
            ? await saveService({ environmentId, input: request.input })
            : await saveCheck({ environmentId, input: request.input });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      onChanged();
      const toastId = toastManager.add({
        type: "success",
        title: active ? `Watching ${name} again` : `Paused ${name}`,
        description: active
          ? "Its checks count toward its state again."
          : "It stays registered with its history. Resume it any time.",
        actionProps: {
          children: "Undo",
          onClick: () => {
            toastManager.close(toastId);
            void apply(target, !active);
          },
        },
      });
    })()
      .catch((cause) => {
        toastManager.add({
          type: "error",
          title: active ? `Could not resume ${name}` : `Could not pause ${name}`,
          description: Schema.isSchemaError(cause)
            ? "Some of its saved details no longer fit what Sites accepts. Open it to fix them."
            : failureText(cause),
        });
      })
      .finally(() => {
        setPending((keys) => {
          const next = new Set(keys);
          next.delete(key);
          return next;
        });
      });
  };
  return {
    /** The `kind:id` of each entry being saved, so its control can say so. */
    pending,
    toggle: (target: ActiveToggleTarget) => void apply(target, !target.row.active),
  };
}
