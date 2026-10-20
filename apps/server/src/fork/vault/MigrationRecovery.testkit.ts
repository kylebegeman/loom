// @effect-diagnostics nodeBuiltinImport:off -- This synthetic-only model hashes in-memory images and has no host adapters.
// @effect-diagnostics preferSchemaOverJson:off -- Canonical JSON is the synthetic model's digest input, not a persistence API.
import * as NodeCrypto from "node:crypto";
import * as Schema from "effect/Schema";

// Only the test suite imports this executable design. A route token is not a Git URL or a writer.
const Id = Schema.String.check(Schema.isPattern(/^synthetic-[a-z0-9-]{1,48}$/));
const Revision = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 }));
const SshUrl = Schema.Struct({
  kind: Schema.Literal("ssh"),
  syntax: Schema.Literals(["scp-relative", "scp-absolute", "ssh-url"]),
  user: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,31}$/)),
  host: Schema.String.check(Schema.isPattern(/^[a-z0-9-]{1,40}\.invalid$/)),
  port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
  path: Schema.String.check(
    Schema.isMaxLength(256),
    Schema.isPattern(/^\/?[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.git$/),
  ),
}).check(
  Schema.makeFilter((url) =>
    url.syntax === "scp-relative"
      ? !url.path.startsWith("/") && url.port === 22
      : url.path.startsWith("/") && (url.syntax === "ssh-url" || url.port === 22),
  ),
);
const RouteToken = Schema.Struct({ kind: Schema.Literal("synthetic-route-token"), routeId: Id });
const FetchValues = Schema.NullOr(
  Schema.Array(Schema.Union([SshUrl, RouteToken])).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(8),
  ),
);
const Route = Schema.Struct({
  routeId: Id,
  itemId: Id,
  itemVersion: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000_000 })),
  operation: Schema.Literal("ssh-repository-read"),
});
const Manifest = Schema.NullOr(Route);
const Identity = Schema.Struct({
  environment: Id,
  project: Id,
  worktree: Id,
  gitDirectory: Id,
  gitFile: Id,
  manifestFile: Id,
});
const Image = Schema.Struct({
  mode: Schema.Literal("synthetic-only"),
  identity: Identity,
  git: Schema.Struct({
    revision: Revision,
    remote: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,32}$/)),
    fetch: FetchValues,
    // Opaque synthetic sentinels prove preservation without copying unrelated data into capture.
    unrelated: Schema.Array(Id).check(Schema.isMaxLength(16)),
  }),
  manifest: Schema.Struct({ revision: Revision, value: Manifest }),
});
const Input = Schema.Struct({
  mode: Schema.Literal("synthetic-only"),
  snapshotId: Id,
  sourceBinding: Id,
  selectedIndex: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 7 })),
  route: Route,
  image: Image,
});
type Image = typeof Image.Type;
type Identity = typeof Identity.Type;
type Resource = "manifest" | "git";
type Direction = "apply" | "rollback";
type Phase =
  | "captured"
  | "applying"
  | "applied"
  | "rolling-back"
  | "rolled-back"
  | "conflict"
  | "unknown";
type Guard = { readonly revision: number; readonly before: string; readonly after: string };
type Snapshot = {
  readonly mode: "synthetic-only";
  readonly protocol: 1;
  readonly id: string;
  readonly sourceBinding: string;
  readonly identity: Identity;
  readonly remote: string;
  readonly selectedIndex: number;
  readonly before: {
    readonly fetch: typeof FetchValues.Type;
    readonly manifest: typeof Manifest.Type;
  };
  readonly after: {
    readonly fetch: typeof FetchValues.Type;
    readonly manifest: typeof Manifest.Type;
  };
  readonly guards: Readonly<Record<Resource, Guard>>;
};
type Proof = { readonly snapshot: Snapshot; readonly digest: string };
type Evidence = {
  readonly sourceBinding: string;
  readonly original: { readonly id: string; readonly validUntil: number };
  readonly replacement: { readonly id: string; readonly validUntil: number };
};
type Intent = {
  readonly operationId: string;
  readonly actor: string;
  readonly direction: Direction;
  readonly evidence: Evidence;
  readonly acceptedRevision: number;
};
type Journal = {
  readonly digest: string;
  readonly revision: number;
  readonly phase: Phase;
  readonly intent: Intent | null;
  readonly integrity: string;
};
type Controls = {
  readonly now: number;
  readonly ledgerAvailable: boolean;
  readonly authorized: boolean;
};
const gates = {
  captureEngine: "unimplemented",
  canCutover: false,
  canRollback: false,
  configurationWrites: false,
} as const;
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Invalid synthetic digest input.");
  return encoded;
};
const hash = (value: unknown) =>
  NodeCrypto.createHash("sha256").update(canonical(value)).digest("hex");
const decodeInput = Schema.decodeUnknownSync(Input, { onExcessProperty: "error" });
const isId = Schema.is(Id);
export const decodeSyntheticImage = Schema.decodeUnknownSync(Image, { onExcessProperty: "error" });
const requireModel: (ok: boolean) => asserts ok = (ok) => {
  if (!ok) throw new Error("Invalid synthetic recovery model input.");
};
const gitHash = (image: Image) =>
  hash({ remote: image.git.remote, fetch: image.git.fetch, unrelated: image.git.unrelated });
const imageHash = (image: Image, resource: Resource) =>
  resource === "git" ? gitHash(image) : hash(image.manifest.value);
const seal = (journal: Omit<Journal, "integrity">): Journal => ({
  ...journal,
  integrity: hash(journal),
});
const validate = (proof: Proof, journal: Journal) => {
  requireModel(proof.digest === hash(proof.snapshot) && journal.digest === proof.digest);
  const { integrity, ...record } = journal;
  requireModel(integrity === hash(record));
  if (journal.phase === "captured") requireModel(journal.intent === null);
  if (journal.phase === "applying" || journal.phase === "applied")
    requireModel(journal.intent?.direction === "apply");
  if (journal.phase === "rolling-back" || journal.phase === "rolled-back")
    requireModel(journal.intent?.direction === "rollback");
};

export const prepareSyntheticRecovery = (input: unknown) => {
  const request = decodeInput(input);
  const image = request.image;
  requireModel(image.git.revision <= 999_998 && image.manifest.revision <= 999_998);
  requireModel(request.selectedIndex < (image.git.fetch?.length ?? 1));
  const fetch = [...(image.git.fetch ?? [])];
  fetch[request.selectedIndex] = { kind: "synthetic-route-token", routeId: request.route.routeId };
  const after = { fetch, manifest: request.route };
  const postimage = {
    ...image,
    git: { ...image.git, fetch },
    manifest: { ...image.manifest, value: request.route },
  };
  const snapshot: Snapshot = {
    mode: "synthetic-only",
    protocol: 1,
    id: request.snapshotId,
    sourceBinding: request.sourceBinding,
    identity: image.identity,
    remote: image.git.remote,
    selectedIndex: request.selectedIndex,
    before: { fetch: image.git.fetch, manifest: image.manifest.value },
    after,
    guards: {
      git: { revision: image.git.revision, before: gitHash(image), after: gitHash(postimage) },
      manifest: {
        revision: image.manifest.revision,
        before: hash(image.manifest.value),
        after: hash(request.route),
      },
    },
  };
  requireModel(new TextEncoder().encode(canonical(snapshot)).length <= 16_384);
  const proof = { snapshot, digest: hash(snapshot) };
  const journal = seal({ digest: proof.digest, revision: 0, phase: "captured", intent: null });
  return { proof, journal, gates };
};

// Revision tokens represent an assumed atomic CAS, including ABA detection, not a host file lock.
const resourceState = (proof: Proof, image: Image, resource: Resource) => {
  const guard = proof.snapshot.guards[resource],
    revision = image[resource].revision,
    digest = imageHash(image, resource);
  if (guard.before === guard.after)
    return revision === guard.revision && digest === guard.before ? "unchanged" : "conflict";
  if (revision === guard.revision && digest === guard.before) return "before";
  if (revision === guard.revision + 1 && digest === guard.after) return "after";
  if (revision === guard.revision + 2 && digest === guard.before) return "restored";
  return "conflict";
};
const inspect = (proof: Proof, observation: unknown) => {
  if (observation === null) return null;
  const image = decodeSyntheticImage(observation);
  if (hash(image.identity) !== hash(proof.snapshot.identity))
    return { image, manifest: "conflict", git: "conflict" } as const;
  return {
    image,
    manifest: resourceState(proof, image, "manifest"),
    git: resourceState(proof, image, "git"),
  };
};
const fresh = (proof: Proof, evidence: Evidence, now: number) =>
  Number.isSafeInteger(now) &&
  now >= 0 &&
  evidence.sourceBinding === proof.snapshot.sourceBinding &&
  evidence.original.id !== evidence.replacement.id &&
  [evidence.original, evidence.replacement].every(
    (r) => isId(r.id) && Number.isSafeInteger(r.validUntil) && now < r.validUntil,
  );
const isBefore = (state: string) => state === "before" || state === "unchanged";
const isAfter = (state: string) => state === "after" || state === "unchanged";
const changedJournal = (journal: Journal, phase: Phase): Journal =>
  phase === journal.phase
    ? journal
    : seal({
        digest: journal.digest,
        intent: journal.intent,
        revision: journal.revision + 1,
        phase,
      });

export const acceptSyntheticIntent = (
  proof: Proof,
  journal: Journal,
  observation: unknown,
  command: {
    readonly direction: Direction;
    readonly operationId: string;
    readonly actor: string;
    readonly expectedRevision: number;
    readonly evidence: Evidence;
  },
  controls: Controls,
): Journal => {
  validate(proof, journal);
  requireModel(
    controls.ledgerAvailable && controls.authorized && fresh(proof, command.evidence, controls.now),
  );
  requireModel(isId(command.operationId) && isId(command.actor));
  if (journal.intent?.operationId === command.operationId) {
    requireModel(
      hash(journal.intent) ===
        hash({
          operationId: command.operationId,
          actor: command.actor,
          direction: command.direction,
          evidence: command.evidence,
          acceptedRevision: command.expectedRevision,
        }),
    );
    return journal;
  }
  requireModel(command.expectedRevision === journal.revision);
  const view = inspect(proof, observation);
  requireModel(view !== null);
  const allowed =
    command.direction === "apply"
      ? journal.phase === "captured" && isBefore(view.git) && isBefore(view.manifest)
      : journal.phase === "applied" && isAfter(view.git) && isAfter(view.manifest);
  requireModel(allowed);
  requireModel(Object.values(proof.snapshot.guards).some((g) => g.before !== g.after));
  return seal({
    digest: journal.digest,
    revision: journal.revision + 1,
    phase: command.direction === "apply" ? "applying" : "rolling-back",
    intent: {
      operationId: command.operationId,
      actor: command.actor,
      direction: command.direction,
      evidence: command.evidence,
      acceptedRevision: command.expectedRevision,
    },
  });
};

export const reconcileSyntheticRecovery = (
  proof: Proof,
  journal: Journal,
  observation: unknown,
  controls: Controls,
) => {
  validate(proof, journal);
  const view = inspect(proof, observation);
  let phase = journal.phase;
  let next: Resource | null = null;
  if (phase !== "conflict" && phase !== "unknown") {
    if (!view) phase = "unknown";
    else {
      const resources = (["manifest", "git"] as const).filter(
        (resource) =>
          proof.snapshot.guards[resource].before !== proof.snapshot.guards[resource].after,
      );
      const unchangedValid = (["manifest", "git"] as const).every(
        (resource) => resources.includes(resource) || view[resource] === "unchanged",
      );
      if (!unchangedValid) phase = "conflict";
      else if (phase === "applying" || phase === "rolling-back") {
        const sequence = phase === "applying" ? resources : resources.toReversed();
        const pending = phase === "applying" ? "before" : "after";
        const complete = phase === "applying" ? "after" : "restored";
        const progress = Array.from({ length: sequence.length + 1 }, (_, count) => count).find(
          (count) =>
            sequence.every(
              (resource, index) => view[resource] === (index < count ? complete : pending),
            ),
        );
        if (progress === undefined) phase = "conflict";
        else if (progress === sequence.length)
          phase = phase === "applying" ? "applied" : "rolled-back";
        else next = sequence[progress] ?? null;
      } else {
        const expected =
          phase === "captured" ? "before" : phase === "applied" ? "after" : "restored";
        if (!resources.every((resource) => view[resource] === expected)) phase = "conflict";
      }
    }
  }
  // Read-only inspection can explain interruption even after evidence expires; a simulated write cannot proceed.
  const blocked = !controls.ledgerAvailable
    ? "ledger-unavailable"
    : !controls.authorized
      ? "denied"
      : journal.intent && !fresh(proof, journal.intent.evidence, controls.now)
        ? "evidence-expired"
        : null;
  const updated =
    controls.ledgerAvailable && controls.authorized ? changedJournal(journal, phase) : journal;
  return { journal: updated, observedPhase: phase, next: blocked ? null : next, blocked, gates };
};

export const simulateSyntheticWrite = (
  proof: Proof,
  journal: Journal,
  observation: unknown,
  controls: Controls,
) => {
  const decision = reconcileSyntheticRecovery(proof, journal, observation, controls);
  requireModel(decision.next !== null && journal.intent !== null);
  const image = decodeSyntheticImage(observation),
    resource = decision.next;
  const target =
    journal.intent.direction === "apply" ? proof.snapshot.after : proof.snapshot.before;
  // One immutable step models a CAS on exactly one resource. The journal is deliberately unchanged
  // so tests can restart after the write but before its completion acknowledgement.
  return resource === "manifest"
    ? { ...image, manifest: { revision: image.manifest.revision + 1, value: target.manifest } }
    : { ...image, git: { ...image.git, revision: image.git.revision + 1, fetch: target.fetch } };
};
