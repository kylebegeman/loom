import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  SitesError,
  SitesSnapshot,
  type SiteChecksRunReceipt,
  type SiteChecksRunReceiptRequest,
  type SaveSiteRequest,
  type SaveSiteServiceRequest,
  type SaveSiteCheckRequest,
  type RunSiteChecksRequest,
  SITES_WS_METHODS,
} from "@t3tools/contracts/fork";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";

/** Keep private site data in memory and route reads to the selected Library authority. */
export function createSitesAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
  options?: { readonly onSnapshot: (environmentId: string, snapshot: SitesSnapshot) => void },
) {
  return {
    saveSite: createEnvironmentRpcCommand(runtime, {
      label: "loom:sites:saveSite",
      tag: SITES_WS_METHODS.saveSite,
    }),
    saveService: createEnvironmentRpcCommand(runtime, {
      label: "loom:sites:saveService",
      tag: SITES_WS_METHODS.saveService,
    }),
    saveCheck: createEnvironmentRpcCommand(runtime, {
      label: "loom:sites:saveCheck",
      tag: SITES_WS_METHODS.saveCheck,
    }),
    runChecks: createEnvironmentRpcCommand(runtime, {
      label: "loom:sites:runChecks",
      tag: SITES_WS_METHODS.runChecks,
    }),

    checkRunReceipt: createEnvironmentRpcCommand(runtime, {
      label: "loom:sites:checkRunReceipt",
      tag: SITES_WS_METHODS.checkRunReceipt,
    }),
    snapshot: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:sites:snapshot",
      tag: SITES_WS_METHODS.snapshot,
      onAnswer: (target, value) =>
        Effect.sync(() => {
          if (value.snapshot) options?.onSnapshot(target.environmentId, value.snapshot);
        }),
    }),
    analytics: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:sites:analytics",
      tag: SITES_WS_METHODS.analytics,
    }),
  };
}

type WriteKind = "site" | "service" | "check" | "runChecks";
type WriteInput =
  | SaveSiteRequest
  | SaveSiteServiceRequest
  | SaveSiteCheckRequest
  | RunSiteChecksRequest;
const PendingWrite = Schema.Struct({
  requestId: Schema.String,
  fingerprint: Schema.String,
  expectedEtag: Schema.optionalKey(Schema.NullOr(Schema.String)),
  observedAt: Schema.NullOr(Schema.String),
});
const decodePending = Schema.decodeUnknownSync(Schema.fromJsonString(PendingWrite));
const isSitesError = Schema.is(SitesError);
const decodeSnapshot = Schema.decodeUnknownSync(SitesSnapshot);

export function siteWritePrecondition(row?: { readonly etag?: string }) {
  return row ? (row.etag ? { expectedEtag: row.etag } : {}) : { expectedEtag: null };
}

function settings(
  kind: WriteKind,
  input:
    | WriteInput
    | SitesSnapshot["sites"][number]
    | SitesSnapshot["services"][number]
    | SitesSnapshot["checks"][number],
) {
  if (!("id" in input)) return [];
  const base = [input.id, input.name, input.url, Boolean(input.active)];
  if (kind === "site" && "origins" in input)
    return [...base, input.origins, input.serviceIds, input.projectIds ?? []];
  if (kind === "service" && "kind" in input) return [...base, input.kind];
  if (kind === "check" && "service_id" in input)
    return [...base, input.service_id, input.expected_status ?? 200, input.content ?? ""];
  return base;
}

/** Persist only request identity and hashes. An uncertain write needs a fresh read and explicit action. */
export function createSitesWriteGuard(storage: {
  readonly load: (key: string) => Promise<string | null>;
  readonly save: (key: string, value: string) => Promise<void>;
  readonly remove: (key: string) => Promise<void>;
  readonly newId: () => string;
  readonly digest: (value: string) => Promise<string>;
}) {
  const latest = new Map<string, SitesSnapshot>();
  const running = new Set<string>();
  return {
    observe(environmentId: string, snapshot: SitesSnapshot) {
      latest.set(environmentId, snapshot);
    },
    async execute<T extends WriteInput>(
      environmentId: string,
      kind: WriteKind,
      input: T,
      send: (input: T & { readonly requestId: string }) => Promise<SitesSnapshot>,
      lookup?: (input: SiteChecksRunReceiptRequest) => Promise<SiteChecksRunReceipt>,
    ): Promise<SitesSnapshot> {
      const id = "id" in input ? input.id : "all";
      const key = `loom.sites.write.v1:${encodeURIComponent(environmentId)}:${kind}:${id}`;
      if (running.has(key)) throw new SitesError({ stage: "unknown-outcome" });
      running.add(key);
      try {
        const snapshot = latest.get(environmentId);
        const expectedEtag = "expectedEtag" in input ? input.expectedEtag : undefined;
        let previous: typeof PendingWrite.Type | null;
        let fingerprint: string;
        try {
          const saved = await storage.load(key);
          previous = saved ? decodePending(saved) : null;
          fingerprint = await storage.digest(JSON.stringify(settings(kind, input)));
        } catch (cause) {
          throw new SitesError({ stage: "recovery", cause });
        }
        if (previous) {
          const unknown = () =>
            new SitesError({ stage: "unknown-outcome", requestId: previous.requestId });
          if (kind === "runChecks") {
            if (!lookup || fingerprint !== previous.fingerprint) throw unknown();
            let receipt: SiteChecksRunReceipt;
            try {
              receipt = await lookup({ requestId: previous.requestId });
            } catch (cause) {
              throw new SitesError({
                stage: isSitesError(cause) ? cause.stage : "unknown-outcome",
                requestId: previous.requestId,
                cause,
              });
            }
            if (receipt.state !== "completed") throw unknown();
            if (receipt.status >= 300) {
              if (receipt.status === 400 || receipt.status === 413) {
                await storage.remove(key);
                throw new SitesError({ stage: "validation", requestId: previous.requestId });
              }
              throw unknown();
            }
            let result: SitesSnapshot;
            try {
              result = decodeSnapshot(receipt.body);
            } catch (cause) {
              throw new SitesError({
                stage: "unknown-outcome",
                requestId: previous.requestId,
                cause,
              });
            }
            await storage.remove(key).catch(() => {});
            latest.set(environmentId, result);
            return result;
          }
          if (
            !snapshot ||
            !Number.isFinite(Date.parse(snapshot.observedAt)) ||
            (previous.observedAt !== null &&
              !(Date.parse(snapshot.observedAt) > Date.parse(previous.observedAt)))
          )
            throw unknown();
          const rows =
            kind === "site"
              ? snapshot.sites
              : kind === "service"
                ? snapshot.services
                : snapshot.checks;
          const current = rows.find((row) => row.id === id);
          const currentFingerprint = current
            ? await storage.digest(JSON.stringify(settings(kind, current)))
            : null;
          if (currentFingerprint === previous.fingerprint && fingerprint === previous.fingerprint) {
            await storage.remove(key);
            return snapshot;
          }
          const revision = current ? current.etag : null;
          if (previous.expectedEtag === undefined || revision === undefined) throw unknown();
          if (fingerprint === previous.fingerprint && expectedEtag === previous.expectedEtag) {
            if (revision !== previous.expectedEtag)
              throw new SitesError({ stage: "revision-conflict", requestId: previous.requestId });
          } else if (expectedEtag !== revision || expectedEtag === previous.expectedEtag) {
            throw new SitesError({ stage: "revision-conflict", requestId: previous.requestId });
          }
        }
        const requestId =
          previous?.fingerprint === fingerprint && expectedEtag === previous.expectedEtag
            ? previous.requestId
            : input.requestId && input.requestId !== previous?.requestId
              ? input.requestId
              : storage.newId();
        try {
          await storage.save(
            key,
            JSON.stringify({
              requestId,
              fingerprint,
              ...(expectedEtag !== undefined ? { expectedEtag } : {}),
              observedAt: snapshot?.observedAt ?? null,
            }),
          );
        } catch (cause) {
          throw new SitesError({ stage: "recovery", cause });
        }
        let result: SitesSnapshot;
        try {
          result = await send({ ...input, requestId });
        } catch (cause) {
          if (isSitesError(cause) && !["unknown-outcome", "write"].includes(cause.stage)) {
            await storage.remove(key).catch(() => {});
            throw cause;
          }
          if (
            typeof cause === "object" &&
            cause !== null &&
            "_tag" in cause &&
            cause._tag === "EnvironmentAuthorizationError"
          ) {
            await storage.remove(key).catch(() => {});
            throw cause;
          }
          throw new SitesError({ stage: "unknown-outcome", requestId, cause });
        }
        // A failed cleanup retains a reconcilable identity; it cannot turn success into a retry.
        await storage.remove(key).catch(() => {});
        latest.set(environmentId, result);
        return result;
      } finally {
        running.delete(key);
      }
    },
  };
}
