import type { EnvironmentId } from "@t3tools/contracts";
import {
  SWITCHBOARD_ENROLL_PATH,
  SWITCHBOARD_HUB_FEATURE,
  SWITCHBOARD_TICKET_ROUTE,
  SwitchboardEnrollment,
  SwitchboardHub,
  SwitchboardTicket,
  SwitchboardTicketRequest,
  type DirectoryEnvironment,
  type SwitchboardAccountState,
  type SwitchboardRouteStatus,
} from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ByteSize from "effect/ByteSize";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import type * as Digest from "effect/crypto/Digest";
import type * as SecureRandom from "effect/crypto/SecureRandom";
import type * as Signature from "effect/crypto/Signature";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import {
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
  HttpIncomingMessage,
} from "effect/http";
import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { signMachineProof } from "../account-access/machineProof.ts";
import { DirectoryService } from "../directory/DirectoryService.ts";
import { LibraryConnectionService } from "../project-library/LibraryConnection.ts";
import { SwitchboardClients } from "./SwitchboardClients.ts";
import {
  resolveSwitchboardConfiguration,
  setSwitchboardAccountRoute,
  SWITCHBOARD_GATEWAY_ERROR_HEADER,
  SWITCHBOARD_GATEWAY_PREFIX,
  type SwitchboardAccountRoute,
  type SwitchboardKeyCommand,
} from "./switchboard.ts";

const CREDENTIAL = "switchboard-account-credential";
const ROUTE = "switchboard-account-route";
/** The first check waits for startup work to settle; a stored route is already in use by then. */
const FIRST_CHECK = "10 seconds";
/** How long each state waits for the next check. A connected computer only confirms its hub. */
const WAIT: Record<SwitchboardAccountState, `${number} minutes` | undefined> = {
  hub: undefined,
  unavailable: "1 minutes",
  searching: "5 minutes",
  connecting: "1 minutes",
  connected: "5 minutes",
  unreachable: "1 minutes",
};

const StoredRoute = Schema.fromJsonString(
  Schema.Struct({
    version: Schema.Literal(1),
    hub: SwitchboardHub,
    url: Schema.String,
    hubOrigins: Schema.Array(Schema.String),
    /** Routing is turned on once, at the first enrollment; turning it off afterwards sticks. */
    autoEnabled: Schema.Boolean,
  }),
);
type StoredRoute = typeof StoredRoute.Type;
const decodeRoute = Schema.decodeUnknownEffect(StoredRoute);
const encodeRoute = Schema.encodeEffect(StoredRoute);
const encodeTicketRequest = Schema.encodeEffect(Schema.fromJsonString(SwitchboardTicketRequest));
const decodeTicket = Schema.decodeUnknownEffect(SwitchboardTicket);
const decodeEnrollment = Schema.decodeUnknownEffect(SwitchboardEnrollment);
const CREDENTIAL_TEXT = /^[a-f0-9]{64}$/u;

class Problem extends Schema.TaggedError<Problem>()("SwitchboardAccountProblem", {
  state: Schema.Literals(["unavailable", "searching", "connecting", "unreachable"]),
  problem: Schema.NullOr(Schema.String),
}) {}
const problem = (state: Problem["state"], text: string | null) =>
  new Problem({ state, problem: text });
const LIBRARY_DOWN = "Your Library could not be reached. Loom will retry.";
const NOT_SAVED = "Loom could not save this computer's Switchboard credential. Loom will retry.";
const OVERRIDDEN =
  "LOOM_SWITCHBOARD_URL or LOOM_SWITCHBOARD_KEY_HELPER routes this computer elsewhere.";
const UNSUPPORTED = "This computer cannot hold a Switchboard credential.";
const json = (response: HttpClientResponse.HttpClientResponse) =>
  response.json.pipe(
    Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.kibibytes(16)),
    Effect.timeout("15 seconds"),
  );

/** The hub's public route; its gateway is the only Switchboard path a reach host serves. */
const publicOrigin = (entry: DirectoryEnvironment) => {
  for (const route of entry.routes) {
    if (route.kind !== "public") continue;
    try {
      const url = new URL(route.url);
      if (url.protocol === "https:") return url.origin;
    } catch {
      /* The directory checks routes; skip one that still does not parse. */
    }
  }
  return undefined;
};
const origins = (entry: DirectoryEnvironment) =>
  entry.routes.flatMap((route) => {
    try {
      return [new URL(route.url).origin];
    } catch {
      return [];
    }
  });

/** The longest-listed hub, or the one this computer already uses while it is still listed. */
export const chooseSwitchboardHub = (
  environments: ReadonlyArray<DirectoryEnvironment>,
  self: EnvironmentId,
  preferred: EnvironmentId | undefined,
) => {
  const hubs = environments
    .filter(
      (entry) =>
        entry.environmentId !== self &&
        entry.loomFeatures.includes(SWITCHBOARD_HUB_FEATURE) &&
        publicOrigin(entry) !== undefined,
    )
    .toSorted((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt));
  return hubs.find((entry) => entry.environmentId === preferred) ?? hubs[0];
};

/**
 * On a computer that does not share its Switchboard: finds the account's hub in the Library
 * directory, obtains this computer's own credential for it, and routes launches through it. The
 * credential and route live in the server secret store, so a Library outage changes nothing until
 * the hub itself refuses the credential.
 */
export class SwitchboardAccount extends Context.Service<
  SwitchboardAccount,
  {
    readonly status: Effect.Effect<SwitchboardRouteStatus>;
    /** Checks the hub now, enrolling when needed, as the background loop does on its schedule. */
    readonly refresh: Effect.Effect<SwitchboardRouteStatus>;
    /** Drops this computer's credential and enrolls again now. */
    readonly reconnect: Effect.Effect<SwitchboardRouteStatus>;
    /** On the hub: revokes one computer's credential. */
    readonly revokeComputer: (
      environmentId: EnvironmentId,
    ) => Effect.Effect<SwitchboardRouteStatus>;
  }
>()("t3/fork/switchboard/SwitchboardAccount") {}

const make = Effect.gen(function* () {
  const environment = yield* HostProcess.Environment;
  const platform = yield* HostProcess.Platform;
  const secrets = yield* ServerSecretStore;
  const connection = yield* LibraryConnectionService;
  const directory = yield* DirectoryService;
  const settings = yield* ServerSettingsService;
  const clients = yield* SwitchboardClients;
  const path = yield* Path.Path;
  const http = yield* HttpClient.HttpClient;
  const signing = yield* Effect.context<
    Signature.Signature | Digest.Digest | SecureRandom.SecureRandom | ServerSecretStore
  >();
  const self = yield* (yield* ServerEnvironmentIdentity).getEnvironmentId;
  const sharing = environment.LOOM_SWITCHBOARD_SHARE_GATEWAY === "true";
  const lock = yield* Semaphore.make(1);
  // `cat` prints the stored credential for Codex and Claude, which run the command themselves.
  const keyCommand: SwitchboardKeyCommand | undefined =
    secrets.directory === undefined || platform === "win32"
      ? undefined
      : { command: "/bin/cat", args: [path.join(secrets.directory, `${CREDENTIAL}.bin`)] };

  let state: SwitchboardAccountState = sharing ? "hub" : "connecting";
  let hub: typeof SwitchboardHub.Type | null = null;
  let checkedAt: number | null = null;
  let note: string | null = null;

  const accountRoute = (
    route: StoredRoute,
    command: SwitchboardKeyCommand,
  ): SwitchboardAccountRoute => ({
    url: route.url,
    keyCommand: command,
    hubOrigins: route.hubOrigins,
  });
  const readRoute = secrets.get(ROUTE).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.undefined,
        onSome: (bytes) => decodeRoute(new TextDecoder().decode(bytes)),
      }),
    ),
    Effect.orElseSucceed(() => undefined),
  );
  const readCredential = secrets.get(CREDENTIAL).pipe(
    Effect.map(Option.map((bytes) => new TextDecoder().decode(bytes))),
    Effect.map(Option.filter((text) => CREDENTIAL_TEXT.test(text))),
    Effect.orElseSucceed(() => Option.none<string>()),
  );
  const forget = Effect.gen(function* () {
    setSwitchboardAccountRoute(undefined);
    yield* secrets.remove(CREDENTIAL).pipe(Effect.ignore);
  });

  /** Whether the environment settings send launches to this hub, as they do when none are set. */
  const routesThrough = (route: SwitchboardAccountRoute) => {
    try {
      return resolveSwitchboardConfiguration(environment, platform, route).source === "account";
    } catch {
      return false;
    }
  };

  const hubRequest = (request: HttpClientRequest.HttpClientRequest) =>
    http
      .execute(request)
      .pipe(
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
        Effect.timeout("15 seconds"),
        Effect.option,
      );

  const check = Effect.fn("SwitchboardAccount.check")(function* (
    route: StoredRoute,
    credential: string,
  ) {
    const response = yield* hubRequest(
      HttpClientRequest.get(`${route.url}/v1/models`).pipe(
        HttpClientRequest.bearerToken(credential),
      ),
    );
    if (Option.isSome(response) && response.value.status === 200) return "accepted" as const;
    // A hub that stops sharing answers `disabled`; enrolling again finds the account's next hub.
    const refusal = Option.isSome(response)
      ? response.value.headers[SWITCHBOARD_GATEWAY_ERROR_HEADER]
      : undefined;
    if (
      Option.isSome(response) &&
      ((response.value.status === 401 && refusal === "authentication") ||
        (response.value.status === 404 && refusal === "disabled"))
    )
      return "refused" as const;
    return "unreachable" as const;
  });

  const enroll = Effect.fn("SwitchboardAccount.enroll")(function* (
    stored: StoredRoute | undefined,
    command: SwitchboardKeyCommand,
  ) {
    const current = yield* connection.current;
    if (current.kind === "authority")
      return yield* problem("unavailable", "The Library computer does not use an account hub yet.");
    if (current.kind !== "remote" || !current.credential?.account)
      return yield* problem(
        "unavailable",
        "Sign this computer in to your Loom account to use its Switchboard.",
      );
    const credential = current.credential;
    const account = current.credential.account;
    const listing = yield* directory.computers.pipe(
      Effect.mapError(() => problem("connecting", LIBRARY_DOWN)),
    );
    const entry = chooseSwitchboardHub(listing.environments, self, stored?.hub.environmentId);
    if (entry === undefined) return yield* problem("searching", null);
    const next: StoredRoute = {
      version: 1,
      hub: { environmentId: entry.environmentId, label: entry.label },
      url: `${publicOrigin(entry)}${SWITCHBOARD_GATEWAY_PREFIX}`,
      hubOrigins: origins(entry),
      autoEnabled: stored?.autoEnabled ?? false,
    };
    hub = next.hub;
    if (!routesThrough(accountRoute(next, command)))
      return yield* problem("unavailable", OVERRIDDEN);

    const payload = yield* encodeTicketRequest({ hubEnvironmentId: entry.environmentId }).pipe(
      Effect.orDie,
    );
    const proof = yield* signMachineProof(payload, {
      sourceEnvironmentId: credential.sourceEnvironmentId,
      libraryEnvironmentId: credential.libraryEnvironmentId,
      sessionId: credential.sessionId,
      account,
    }).pipe(
      Effect.provide(signing),
      Effect.mapError(() => problem("connecting", "Loom could not sign this computer's request.")),
    );
    const ticketRequest = yield* HttpClientRequest.bodyJson(
      HttpClientRequest.post(current.endpoint(SWITCHBOARD_TICKET_ROUTE)),
      { payload, proof },
    ).pipe(Effect.orDie);
    const issued = yield* current.send(ticketRequest).pipe(
      Effect.timeout("15 seconds"),
      Effect.mapError(() => problem("connecting", LIBRARY_DOWN)),
    );
    if (issued.status === 404)
      return yield* problem(
        "connecting",
        "Update Loom on your Library to share Switchboard across your account.",
      );
    if (issued.status === 403)
      return yield* problem(
        "connecting",
        `Your Library did not confirm this computer or ${entry.label} as account members.`,
      );
    if (issued.status !== 200) return yield* problem("connecting", LIBRARY_DOWN);
    const { ticket } = yield* json(issued).pipe(
      Effect.flatMap(decodeTicket),
      Effect.mapError(() => problem("connecting", LIBRARY_DOWN)),
    );

    const hubUnreachable = `${entry.label} could not be reached. Loom will retry.`;
    const enrollRequest = yield* HttpClientRequest.bodyJson(
      HttpClientRequest.post(`${next.url}${SWITCHBOARD_ENROLL_PATH}`),
      { ticket },
    ).pipe(Effect.orDie);
    const enrolled = yield* hubRequest(enrollRequest);
    if (Option.isNone(enrolled)) return yield* problem("connecting", hubUnreachable);
    if (enrolled.value.status === 404)
      return yield* problem("connecting", `Update Loom on ${entry.label}.`);
    if (enrolled.value.status === 403)
      return yield* problem(
        "connecting",
        `${entry.label} could not confirm this computer with your Library. Loom will retry.`,
      );
    if (enrolled.value.status !== 200) return yield* problem("connecting", hubUnreachable);
    const issuedCredential = yield* json(enrolled.value).pipe(
      Effect.flatMap(decodeEnrollment),
      Effect.mapError(() => problem("connecting", hubUnreachable)),
    );

    const text = yield* encodeRoute(next).pipe(Effect.orDie);
    yield* secrets
      .set(CREDENTIAL, new TextEncoder().encode(Redacted.value(issuedCredential.credential)))
      .pipe(
        Effect.andThen(secrets.set(ROUTE, new TextEncoder().encode(text))),
        Effect.mapError(() => problem("connecting", NOT_SAVED)),
      );
    setSwitchboardAccountRoute(accountRoute(next, command));
    yield* Effect.logInfo("This computer now routes through the account's Switchboard.", {
      hub: entry.environmentId,
    });
    if (!next.autoEnabled) {
      yield* settings.updateSettings({ switchboardEnabled: true }).pipe(
        Effect.andThen(
          encodeRoute({ ...next, autoEnabled: true }).pipe(
            Effect.flatMap((saved) => secrets.set(ROUTE, new TextEncoder().encode(saved))),
          ),
        ),
        Effect.tapError(() => Effect.logWarning("Could not turn on Switchboard routing.")),
        Effect.ignore,
      );
    }
  });

  const cycle = Effect.fn("SwitchboardAccount.cycle")(
    function* (command: SwitchboardKeyCommand) {
      const stored = yield* readRoute;
      const credential = yield* readCredential;
      if (stored !== undefined && !routesThrough(accountRoute(stored, command)))
        return yield* problem("unavailable", OVERRIDDEN);
      if (stored !== undefined && Option.isSome(credential)) {
        hub = stored.hub;
        const result = yield* check(stored, credential.value);
        if (result === "unreachable")
          return yield* problem(
            "unreachable",
            `${stored.hub.label} did not answer the last check. Launches still use it.`,
          );
        if (result === "accepted") return;
        yield* Effect.logInfo("The Switchboard hub refused this computer's credential.");
        yield* forget;
      }
      yield* enroll(stored, command);
    },
    Effect.catchDefect(() =>
      Effect.fail(problem("connecting", "Switchboard setup failed. Loom will retry.")),
    ),
    Effect.matchEffect({
      onFailure: (failure) =>
        Effect.sync(() => {
          state = failure.state;
          note = failure.problem;
        }),
      onSuccess: () =>
        Effect.map(Clock.currentTimeMillis, (now) => {
          state = "connected";
          note = null;
          checkedAt = now;
        }),
    }),
    lock.withPermit,
  );

  const routed = (): Pick<SwitchboardRouteStatus, "source" | "url"> => {
    try {
      const { source, url } = resolveSwitchboardConfiguration(environment, platform);
      return { source, url };
    } catch {
      return { source: "invalid", url: null };
    }
  };

  const status = Effect.gen(function* () {
    const enabled = yield* settings.getSettings.pipe(
      Effect.map((current) => current.switchboardEnabled),
      Effect.orElseSucceed(() => false),
    );
    return {
      enabled,
      ...routed(),
      account: { state, hub, checkedAt, problem: note },
      ...(sharing ? { computers: yield* clients.list } : {}),
    } satisfies SwitchboardRouteStatus;
  }).pipe(Effect.withSpan("SwitchboardAccount.status"));

  // The hub routes through its own Switchboard; every other computer provisions itself.
  const command = sharing ? undefined : keyCommand;
  if (command !== undefined) {
    const stored = yield* readRoute;
    if (stored !== undefined && Option.isSome(yield* readCredential)) {
      hub = stored.hub;
      // Launches use the stored hub from the start, without waiting on the Library or the hub.
      const route = accountRoute(stored, command);
      if (routesThrough(route)) setSwitchboardAccountRoute(route);
    }
  } else if (!sharing) {
    state = "unavailable";
    note = UNSUPPORTED;
  }

  const refresh = command === undefined ? status : cycle(command).pipe(Effect.andThen(status));
  if (command !== undefined)
    yield* Effect.sleep(FIRST_CHECK).pipe(
      Effect.andThen(
        Effect.forever(
          refresh.pipe(
            Effect.flatMap(({ account }) => Effect.sleep(WAIT[account.state] ?? "5 minutes")),
          ),
        ),
      ),
      Effect.forkScoped,
    );

  return SwitchboardAccount.of({
    status,
    refresh,
    reconnect:
      command === undefined
        ? status
        : Effect.gen(function* () {
            yield* lock.withPermit(forget);
            return yield* refresh;
          }).pipe(Effect.withSpan("SwitchboardAccount.reconnect")),
    revokeComputer: Effect.fn("SwitchboardAccount.revokeComputer")(function* (environmentId) {
      // A failed write leaves the computer listed, which the returned status shows.
      yield* clients.revoke(environmentId).pipe(
        Effect.tapError(() => Effect.logWarning("Could not revoke a Switchboard credential.")),
        Effect.ignore,
      );
      return yield* status;
    }),
  });
});

export const layer = Layer.effect(SwitchboardAccount, make);
