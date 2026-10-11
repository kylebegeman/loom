import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Struct from "effect/Struct";
import * as Schema from "effect/Schema";
import type * as Semaphore from "effect/Semaphore";
import { CheckpointRef } from "@t3tools/contracts";
import {
  PcbWorkspace,
  PcbPreviewError,
  type PcbChangeRequestInput,
  type PcbChangeRequestOperation,
  type PcbInspectInput,
} from "@t3tools/contracts/fork";
import type { CheckpointStore } from "../../checkpointing/CheckpointStore.ts";
export type RequestActor = "user" | "agent";
export const AGENT_REQUEST_REFUSAL =
  "Only the user can accept, reopen, create, edit or delete change requests.";
export const requestRefs = (id: string) => ({
  base: `refs/loom/pcb-requests/${id}/base`,
  resolved: `refs/loom/pcb-requests/${id}/resolved`,
});
interface RequestContext {
  actor: RequestActor;
  now: string;
  sourceHash: string;
  baseRef: string | null;
  resolvedRef: string | null;
}
export function applyRequestOperation(
  current: PcbWorkspace,
  operation: PcbChangeRequestOperation,
  context: RequestContext,
): PcbWorkspace {
  const { actor, now, sourceHash } = context;
  const existing =
    "id" in operation ? current.requests.find((r) => r.id === operation.id) : undefined;
  if (
    actor === "agent" &&
    (operation.op !== "status" ||
      operation.status === "accepted" ||
      existing?.status === "accepted")
  )
    throw new Error(AGENT_REQUEST_REFUSAL);
  if (operation.op === "create" || operation.op === "convert-note") {
    if (current.requests.length >= 30) throw new Error("Delete accepted requests to add more.");
    if (current.requests.some((r) => r.id === operation.request.id))
      throw new Error("Change request IDs must be unique.");
    if (
      operation.request.anchor.kind === "area" &&
      (operation.request.anchor.box.width <= 0 || operation.request.anchor.box.height <= 0)
    )
      throw new Error("Choose an area with positive dimensions.");
    if (
      operation.request.referenceImage &&
      !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(
        operation.request.referenceImage,
      )
    )
      throw new Error("Provide an embedded reference image.");
    if (
      operation.op === "convert-note" &&
      !current.annotations.some((n) => n.id === operation.noteId)
    )
      throw new Error("That note no longer exists.");
    return {
      ...current,
      annotations:
        operation.op === "convert-note"
          ? current.annotations.filter((n) => n.id !== operation.noteId)
          : current.annotations,
      requests: [
        ...current.requests,
        {
          ...operation.request,
          createdAt: now,
          status: "open",
          baseRef: context.baseRef,
          sentAt: operation.op === "create" && operation.sent ? now : null,
          response: null,
          reviewRevision: null,
          resolvedRevision: null,
          resolvedRef: null,
          resolvedAt: null,
        },
      ],
    };
  }
  if (operation.op === "sent") {
    if (
      new Set(operation.ids).size !== operation.ids.length ||
      operation.ids.some((id) => !current.requests.some((r) => r.id === id))
    )
      throw new Error("Choose existing requests once each.");
    return {
      ...current,
      requests: current.requests.map((r) =>
        operation.ids.includes(r.id) ? { ...r, sentAt: now } : r,
      ),
    };
  }
  if (!existing) throw new Error("That change request no longer exists.");
  if (operation.op === "remove")
    return { ...current, requests: current.requests.filter((r) => r.id !== operation.id) };
  return {
    ...current,
    requests: current.requests.map((r) => {
      if (r.id !== operation.id) return r;
      if (operation.op === "edit")
        return {
          ...r,
          ...(operation.title !== undefined ? { title: operation.title } : {}),
          ...(operation.request !== undefined ? { request: operation.request } : {}),
        };
      return {
        ...r,
        status: operation.status,
        response: operation.response === undefined ? r.response : operation.response,
        reviewRevision: operation.status === "review" ? sourceHash : r.reviewRevision,
        resolvedRevision: operation.status === "accepted" ? sourceHash : null,
        resolvedRef: operation.status === "accepted" ? context.resolvedRef : null,
        resolvedAt: operation.status === "accepted" ? now : null,
      };
    }),
  };
}
const decode = Schema.decodeUnknownEffect(PcbWorkspace);
const isPreviewError = Schema.is(PcbPreviewError);
const error = (reason: PcbPreviewError["reason"], message: string) =>
  new PcbPreviewError({ reason, message });
export function makeChangeRequests<R extends { root: string }>(deps: {
  resolve: (i: PcbInspectInput) => Effect.Effect<R, PcbPreviewError>;
  hash: (r: R) => Effect.Effect<string, PcbPreviewError>;
  read: (r: R) => Effect.Effect<PcbWorkspace, PcbPreviewError>;
  write: (r: R, w: PcbWorkspace) => Effect.Effect<void, PcbPreviewError>;
  publish: (r: R, w: PcbWorkspace) => Effect.Effect<unknown>;
  refKey: (r: R, id: string) => string;
  lock: Semaphore.Semaphore;
  checkpoints: CheckpointStore["Service"];
}) {
  const capture = Effect.fn("PcbRequests.capture")(
    function* (root: string, ref: string) {
      if (!(yield* deps.checkpoints.isGitRepository(root))) return null;
      yield* deps.checkpoints.captureCheckpoint({
        cwd: root,
        checkpointRef: CheckpointRef.make(ref),
      });
      return ref;
    },
    Effect.catch((cause) =>
      Effect.logWarning("PCB request baseline unavailable", cause).pipe(Effect.as(null)),
    ),
  );
  const changeRequest = Effect.fn("PcbRequests.changeRequest")(function* (
    input: PcbChangeRequestInput,
    actor: RequestActor,
  ) {
    const resolved = yield* deps.resolve(input);
    return yield* deps.lock.withPermit(
      Effect.gen(function* () {
        const current = yield* deps.read(resolved);
        if (current.version !== input.expectedVersion)
          return yield* error(
            "conflict",
            "These requests changed on another client. Reload them before saving.",
          );
        const hash = yield* deps.hash(resolved),
          now = DateTime.formatIso(yield* DateTime.now),
          op = input.operation;
        // Validate actor, operation and limits before creating host resources.
        const validate = (baseRef: string | null, resolvedRef: string | null) =>
          Effect.try({
            try: () =>
              applyRequestOperation(current, op, {
                actor,
                now,
                sourceHash: hash,
                baseRef,
                resolvedRef,
              }),
            catch: (c) =>
              error(
                "invalid-parameters",
                c instanceof Error ? c.message : "Invalid change request.",
              ),
          });
        yield* validate(null, null);
        let baseRef: string | null = null,
          resolvedRef: string | null = null;
        if (op.op === "create" || op.op === "convert-note") {
          if (op.request.sourceHash !== hash)
            return yield* error(
              "conflict",
              "The design changed. Wait for the current drawing before requesting a change.",
            );
          baseRef = yield* capture(
            resolved.root,
            requestRefs(deps.refKey(resolved, op.request.id)).base,
          );
        } else if (op.op === "status" && op.status === "accepted") {
          const previous = current.requests.find((r) => r.id === op.id)!;
          if (previous.status === "accepted") return current;
          resolvedRef = yield* capture(
            resolved.root,
            requestRefs(deps.refKey(resolved, op.id)).resolved,
          );
        }
        if (baseRef || resolvedRef) {
          const captureHash = yield* deps.hash(resolved);
          if (captureHash !== hash) {
            yield* deps.checkpoints
              .deleteCheckpointRefs({
                cwd: resolved.root,
                checkpointRefs: [baseRef, resolvedRef]
                  .filter((r): r is string => r !== null)
                  .map((r) => CheckpointRef.make(r)),
              })
              .pipe(Effect.ignore);
            return yield* error(
              "conflict",
              "The design changed while its request revision was captured. Try again.",
            );
          }
        }
        const next = yield* validate(baseRef, resolvedRef).pipe(
          Effect.flatMap((value) => decode({ ...value, version: current.version + 1 })),
          Effect.mapError((c) =>
            isPreviewError(c)
              ? c
              : error("invalid-parameters", "Change request exceeds its limits."),
          ),
        );
        yield* deps.write(resolved, next).pipe(
          Effect.onError(() => {
            const refs = [baseRef, resolvedRef].filter((r): r is string => r !== null);
            return deps.checkpoints
              .deleteCheckpointRefs({
                cwd: resolved.root,
                checkpointRefs: refs.map((r) => CheckpointRef.make(r)),
              })
              .pipe(Effect.ignore);
          }),
        );
        yield* deps.publish(resolved, next);
        if (op.op === "remove" || (op.op === "status" && op.status !== "accepted")) {
          const previous = current.requests.find((r) => r.id === op.id)!;
          const refs = (
            op.op === "remove" ? [previous.baseRef, previous.resolvedRef] : [previous.resolvedRef]
          ).filter((r): r is string => r !== null);
          if (refs.length)
            yield* deps.checkpoints
              .deleteCheckpointRefs({
                cwd: resolved.root,
                checkpointRefs: refs.map((r) => CheckpointRef.make(r)),
              })
              .pipe(Effect.ignore);
        }
        return next;
      }),
    );
  });
  const listRequests = Effect.fn("PcbRequests.listRequests")(function* (
    input: PcbInspectInput,
    status = "open",
  ) {
    const r = yield* deps.resolve(input),
      data = yield* deps.read(r),
      hash = yield* deps.hash(r);
    return data.requests
      .filter((r) => status === "all" || r.status === status)
      .map(Struct.omit(["referenceImage"]))
      .map((request) => ({
        ...request,
        designChanged: hash !== request.sourceHash,
        anchorDescription:
          request.anchor.kind === "component"
            ? request.anchor.reference
            : request.anchor.kind === "net"
              ? `net ${request.anchor.name}`
              : "area",
      }));
  });
  return { changeRequest, listRequests };
}
