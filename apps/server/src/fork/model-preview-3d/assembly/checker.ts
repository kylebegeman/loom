import type { BoardFeatures } from "../../pcb-preview/enclosure/features.ts";
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as DateTime from "effect/DateTime";
import type * as Scope from "effect/Scope";
import {
  ASSEMBLY_CHECK_VERSION,
  ModelPreviewError,
  partMatrix,
  type AssemblyBounds,
  type AssemblyPart,
  type AssemblyReadResult,
  type AssemblyCheckOptions,
  type AssemblyCheckResult,
  type AssemblyCheckReport,
  type ModelFileRef,
} from "@t3tools/contracts/fork";
import { makeSharedJobs } from "../../sharedJobs.ts";
import { runAssemblyWorker, runBoundsWorker } from "../check/workerHost.ts";
import { makeCheckCoordinator, type CheckCoordinator } from "../check/coordinator.ts";
import type { AssemblyWorkerPart, AssemblyWorkerRequest } from "../check/protocol.ts";
import type { AssemblyGeometry } from "./geometry.ts";
const json = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const hash = (value: unknown) =>
  NodeCrypto.createHash("sha256").update(json(value)).digest("hex").slice(0, 24);
const fail = (message: string) => new ModelPreviewError({ reason: "invalid-parameter", message });
export const makeAssemblyChecker = (deps: {
  features?: (
    file: ModelFileRef,
    part: AssemblyPart,
    requirements: import("@t3tools/contracts/fork").EnclosureRequirements,
  ) => Effect.Effect<BoardFeatures, ModelPreviewError>;
  assembly: (file: ModelFileRef) => Effect.Effect<AssemblyReadResult, ModelPreviewError>;
  geometry: (
    file: ModelFileRef,
    part: AssemblyPart,
    allowLarge?: boolean,
  ) => Effect.Effect<AssemblyGeometry, ModelPreviewError, Scope.Scope>;
  geometryRevision?: (
    file: ModelFileRef,
    part: AssemblyPart,
    allowLarge?: boolean,
  ) => Effect.Effect<string | null, ModelPreviewError>;
  coordinator?: CheckCoordinator;
  runWorker?: typeof runAssemblyWorker;
  runBounds?: typeof runBoundsWorker;
}) =>
  Effect.gen(function* () {
    const coordinator = deps.coordinator ?? (yield* makeCheckCoordinator),
      jobs = yield* makeSharedJobs<AssemblyCheckReport, ModelPreviewError>(),
      boundsJobs = yield* makeSharedJobs<AssemblyBounds, ModelPreviewError>();
    const reports = new Map<string, AssemblyCheckReport>(),
      boundsCache = new Map<string, AssemblyBounds>();
    const boundsOf = Effect.fn("Assembly.bounds")(function* (
      file: ModelFileRef,
      part: AssemblyPart,
    ) {
      const revision = deps.geometryRevision ? yield* deps.geometryRevision(file, part) : null;
      const probe = revision ? boundsCache.get(hash([revision, part.rotation])) : null;
      const result =
        probe ??
        (yield* Effect.scoped(
          Effect.gen(function* () {
            const geometry = yield* deps.geometry(file, part),
              key = hash([geometry.geometryRevision, part.rotation]);
            const cached = boundsCache.get(key);
            if (cached) {
              boundsCache.delete(key);
              boundsCache.set(key, cached);
              return cached;
            }
            return yield* boundsJobs.run(
              key,
              coordinator.withPermit(
                Effect.gen(function* () {
                  const reply = yield* (deps.runBounds ?? runBoundsWorker)({
                    kind: "bounds",
                    part: {
                      id: part.id,
                      ...geometry,
                      matrix: partMatrix([0, 0, 0], part.rotation),
                    },
                    limits: { maxTriangles: 3_000_000 },
                  });
                  if (!reply.ok) return yield* new ModelPreviewError(reply);
                  boundsCache.set(key, reply.bounds);
                  while (boundsCache.size > 128)
                    boundsCache.delete(boundsCache.keys().next().value!);
                  return reply.bounds;
                }),
              ),
            );
          }),
        ));
      return {
        min: result.min.map((value, i) => value + part.position[i]!) as [number, number, number],
        max: result.max.map((value, i) => value + part.position[i]!) as [number, number, number],
      };
    });
    const check = Effect.fn("Assembly.check")(function* (
      input: { file: ModelFileRef; requestId?: string } & AssemblyCheckOptions,
    ) {
      const snapshot = yield* deps.assembly(input.file),
        doc = snapshot.assembly,
        pairIds = new Map<
          string,
          { a: string; b: string; clearanceId: string | null; requiredMm: number | null }
        >(),
        byId = new Map(doc.parts.map((part) => [part.id, part]));
      const addPair = (a: string, b: string) => {
        if (a === b || !byId.has(a) || !byId.has(b)) return false;
        const key = [a, b].sort().join("\0");
        if (!pairIds.has(key)) pairIds.set(key, { a, b, clearanceId: null, requiredMm: null });
        return true;
      };
      if (input.pairs) {
        for (const [a, b] of input.pairs)
          if (!addPair(a, b))
            return yield* fail("Fit pairs must name two different existing parts.");
      } else {
        const visible = doc.parts.filter((p) => p.visible);
        for (let i = 0; i < visible.length; i++)
          for (let j = i + 1; j < visible.length; j++) addPair(visible[i]!.id, visible[j]!.id);
      }
      for (const clearance of doc.clearances) {
        addPair(clearance.a, clearance.b);
        const pair = pairIds.get([clearance.a, clearance.b].sort().join("\0"))!;
        pair.clearanceId = clearance.id;
        pair.requiredMm = clearance.requiredMm;
      }
      const caseParts = doc.enclosure
        ? doc.parts
            .filter(
              (p) =>
                p.visible &&
                p.id !== doc.enclosure!.board &&
                (!doc.enclosure!.parts.length || doc.enclosure!.parts.includes(p.id)),
            )
            .map((p) => p.id)
        : [];
      if (doc.enclosure) for (const id of caseParts) addPair(doc.enclosure.board, id);
      const boardPart = doc.enclosure ? byId.get(doc.enclosure.board) : null;
      const featureResult =
        deps.features && doc.enclosure && boardPart
          ? yield* Effect.result(deps.features(input.file, boardPart, doc.enclosure.requirements))
          : null;
      const enclosure = featureResult
        ? featureResult._tag === "Success"
          ? {
              board: doc.enclosure!.board,
              caseParts,
              features: featureResult.success,
              requirements: doc.enclosure!.requirements,
            }
          : null
        : null;
      const enclosureKey = [
        enclosure,
        featureResult
          ? featureResult._tag === "Failure"
            ? featureResult.failure.message
            : null
          : null,
      ];
      const needed = new Set([...pairIds.values()].flatMap((p) => [p.a, p.b])),
        parts: AssemblyWorkerPart[] = [],
        skipped: AssemblyCheckReport["skipped"][number][] = [];
      const selectedParts = doc.parts.filter(
        (part) => needed.has(part.id) || (input.pairs === undefined && part.visible),
      );
      if (deps.geometryRevision && !input.force) {
        const revisions = yield* Effect.forEach(
          selectedParts,
          (part) => deps.geometryRevision!(input.file, part, input.allowLarge),
          { concurrency: 4 },
        );
        if (revisions.every((revision) => revision !== null)) {
          const key = hash([
            ASSEMBLY_CHECK_VERSION,
            enclosureKey,
            snapshot.revision,
            selectedParts.map((part, i) => [
              part.id,
              revisions[i],
              partMatrix(part.position, part.rotation),
            ]),
            [...pairIds.values()],
          ]);
          const cached = reports.get(key);
          if (cached) {
            reports.delete(key);
            reports.set(key, cached);
            return {
              status: "ok",
              report: { ...cached, cached: true },
            } satisfies AssemblyCheckResult;
          }
        }
      }
      for (const part of selectedParts) {
        const geometry = yield* Effect.result(deps.geometry(input.file, part, input.allowLarge));
        if (geometry._tag === "Failure")
          skipped.push({ id: part.id, reason: geometry.failure.message });
        else
          parts.push({
            id: part.id,
            ...geometry.success,
            matrix: partMatrix(part.position, part.rotation),
          });
      }
      const available = new Set(parts.map((part) => part.id)),
        pairs = [...pairIds.values()].filter(
          (pair) => available.has(pair.a) && available.has(pair.b),
        ),
        key = hash([
          ASSEMBLY_CHECK_VERSION,
          enclosureKey,
          snapshot.revision,
          parts.map((p) => [p.id, p.geometryRevision, p.matrix]),
          pairs,
        ]);
      const cached = reports.get(key);
      if (cached && !input.force) {
        reports.delete(key);
        reports.set(key, cached);
        return { status: "ok", report: { ...cached, cached: true } } satisfies AssemblyCheckResult;
      }
      const report = yield* jobs.run(
        key,
        coordinator.withPermit(
          Effect.gen(function* () {
            const request: AssemblyWorkerRequest = {
                kind: "assembly",
                ...(enclosure ? { enclosure } : {}),
                parts,
                pairs,
                limits: {
                  maxTriangles: 3_000_000,
                  intersections: 50_000_000,
                  distances: 20_000_000,
                },
              },
              reply = yield* (deps.runWorker ?? runAssemblyWorker)(request);
            if (!reply.ok) return yield* new ModelPreviewError(reply);
            const report: AssemblyCheckReport = {
              version: ASSEMBLY_CHECK_VERSION,
              assemblyRevision: snapshot.revision,
              key,
              checkedAt: DateTime.formatIso(yield* DateTime.now),
              cached: false,
              ...reply.core,
              complete:
                reply.core.complete &&
                !skipped.length &&
                (featureResult ? featureResult._tag === "Success" : true),
              skipped: featureResult
                ? featureResult._tag === "Failure"
                  ? [
                      ...skipped,
                      { id: doc.enclosure!.board, reason: featureResult.failure.message },
                    ]
                  : skipped
                : skipped,
            };
            reports.set(key, report);
            while (reports.size > 16) reports.delete(reports.keys().next().value!);
            return report;
          }),
        ),
      );
      return { status: "ok", report } satisfies AssemblyCheckResult;
    });
    return {
      boundsOf,
      checkAssembly: Effect.fn("Assembly.request")(
        (input: { file: ModelFileRef; requestId?: string } & AssemblyCheckOptions) =>
          coordinator.request(input, check(input)),
      ),
      cancelAssemblyCheck: coordinator.cancel,
    };
  });
