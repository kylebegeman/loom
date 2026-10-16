import {
  LibraryBriefProposal,
  LibraryBriefProposalSource,
  LibraryError,
  LibraryProposeBriefRequest,
  type LibraryAcceptBriefProposalRequest,
  type LibraryBriefProposalStatus,
  type LibraryBriefProposalsRequest,
  type LibraryDismissBriefProposalRequest,
  type LibraryProject,
  type LibraryUpdateProjectRequest,
} from "@t3tools/contracts/fork";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { LibraryStoreError } from "./LibraryStore.ts";

/** A proposal request with its server-assigned source, which is what the request receipt covers. */
export const LibraryProposeBriefCommand = Schema.Struct({
  ...LibraryProposeBriefRequest.fields,
  source: LibraryBriefProposalSource,
});
export type LibraryProposeBriefCommand = typeof LibraryProposeBriefCommand.Type;

type Failure = LibraryError | LibraryStoreError;

/** Catalog steps the proposals share with LibraryService, run inside its request transaction. */
export interface LibraryBriefProposalCatalog {
  readonly getProject: (
    projectId: string,
    revision?: number,
  ) => Effect.Effect<LibraryProject, Failure>;
  /** Saves the next project revision exactly as `updateProject` does. */
  readonly reviseProject: (
    input: LibraryUpdateProjectRequest,
  ) => Effect.Effect<LibraryProject, Failure>;
  readonly appendEvent: (
    aggregateId: string,
    eventType: string,
    payload: string,
    createdAt: string,
  ) => Effect.Effect<void, LibraryStoreError>;
}

const proposalJson = Schema.fromJsonString(LibraryBriefProposal);
const decodeProposal = Schema.decodeEffect(proposalJson);
const encodeProposal = Schema.encodeEffect(proposalJson);
const encodeEventJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
const conflict = () => new LibraryError({ reason: "revision-conflict" });

/** Proposals from one conversation or agent replace that source's earlier pending ones. */
const sourceKey = (source: LibraryBriefProposalSource) => {
  switch (source.kind) {
    case "conversation":
      return `conversation\0${source.environmentId}\0${source.threadId}`;
    case "agent":
      return `agent\0${source.id}`;
    case "user":
      return null;
  }
};

/**
 * Brief proposals on the Library. Anyone may propose and list; only a person deciding
 * through the guarded RPC accepts or dismisses. Mutations run inside LibraryService's
 * request transaction, so accepting saves the brief and decides the proposal together.
 * The `brief.proposed` and `brief.revised` events carry the proposal's id, summary and source,
 * so a timeline can attribute them without reading the proposals table.
 */
export const make = (catalog: LibraryBriefProposalCatalog) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const run = <A, E, R>(operation: string, effect: Effect.Effect<A, E, R>) =>
      effect.pipe(Effect.mapError((cause) => new LibraryStoreError({ operation, cause })));
    const decode = (payload: string) =>
      decodeProposal(payload).pipe(
        Effect.mapError((cause) => new LibraryError({ reason: "io", cause })),
      );
    const encode = (value: unknown) =>
      encodeEventJson(value).pipe(
        Effect.mapError((cause) => new LibraryError({ reason: "invalid", cause })),
      );

    const rows = (
      projectId: string,
      status: LibraryBriefProposalStatus | undefined,
      limit: number,
      offset: number,
    ) =>
      run(
        "brief-proposals",
        sql<{
          payload_json: string;
        }>`SELECT payload_json FROM fork_library_brief_proposals WHERE project_id = ${projectId} ${status ? sql`AND status = ${status}` : sql``} ORDER BY created_at DESC, rowid DESC LIMIT ${limit} OFFSET ${offset}`,
      ).pipe(Effect.flatMap((found) => Effect.forEach(found, (row) => decode(row.payload_json))));
    const load = Effect.fnUntraced(function* (id: string) {
      const [row] = yield* run(
        "brief-proposal",
        sql<{
          payload_json: string;
        }>`SELECT payload_json FROM fork_library_brief_proposals WHERE id = ${id}`,
      );
      if (row === undefined) return yield* new LibraryError({ reason: "not-found" });
      return yield* decode(row.payload_json);
    });
    const save = Effect.fnUntraced(function* (proposal: LibraryBriefProposal) {
      const payload = yield* encodeProposal(proposal).pipe(
        Effect.mapError((cause) => new LibraryError({ reason: "invalid", cause })),
      );
      yield* run(
        "put-brief-proposal",
        sql`INSERT INTO fork_library_brief_proposals (id, project_id, status, payload_json, created_at) VALUES (${proposal.id}, ${proposal.projectId}, ${proposal.status}, ${payload}, ${proposal.createdAt}) ON CONFLICT(id) DO UPDATE SET status = excluded.status, payload_json = excluded.payload_json`,
      );
      return proposal;
    });
    const pending = Effect.fnUntraced(function* (id: string) {
      const proposal = yield* load(id);
      // A decided proposal changed under the person reviewing it; reloading shows its outcome.
      if (proposal.status !== "pending") return yield* conflict();
      return proposal;
    });

    const propose = Effect.fnUntraced(function* (input: LibraryProposeBriefCommand) {
      const current = yield* catalog.getProject(input.projectId);
      // Archived projects take no new proposals; people can still edit or reopen them.
      if (current.archived || input.baseRevision > current.revision)
        return yield* new LibraryError({ reason: "invalid" });
      const base = yield* catalog.getProject(input.projectId, input.baseRevision);
      if (base.brief === input.proposedBrief) return yield* new LibraryError({ reason: "invalid" });
      const timestamp = yield* now;
      const key = sourceKey(input.source);
      if (key !== null)
        for (const earlier of yield* rows(input.projectId, "pending", -1, 0))
          if (sourceKey(earlier.source) === key)
            yield* save({ ...earlier, status: "superseded", decidedAt: timestamp });
      const proposal = yield* save({
        id: yield* randomUuidV4,
        projectId: input.projectId,
        baseRevision: input.baseRevision,
        proposedBrief: input.proposedBrief,
        summary: input.summary,
        source: input.source,
        status: "pending",
        createdAt: timestamp,
      });
      yield* catalog.appendEvent(
        proposal.projectId,
        "brief.proposed",
        yield* encode({
          proposalId: proposal.id,
          baseRevision: proposal.baseRevision,
          summary: proposal.summary,
          source: proposal.source,
        }),
        timestamp,
      );
      // The project timeline reads `timeline.*` events, so the proposal is recorded there too.
      yield* catalog.appendEvent(
        proposal.projectId,
        "timeline.brief-proposed",
        yield* encode({
          kind: "brief-proposed",
          at: timestamp,
          environmentId: input.source.kind === "conversation" ? input.source.environmentId : null,
          proposalId: proposal.id,
          summary: proposal.summary,
        }),
        timestamp,
      );
      return proposal;
    });

    const list = Effect.fnUntraced(function* (input: LibraryBriefProposalsRequest) {
      const offset = input.offset ?? 0;
      const limit = input.limit ?? 50;
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 200
      )
        return yield* new LibraryError({ reason: "invalid" });
      yield* catalog.getProject(input.projectId);
      const found = yield* rows(input.projectId, input.status, limit + 1, offset);
      return {
        proposals: found.slice(0, limit),
        nextOffset: found.length > limit ? offset + limit : null,
      };
    });

    const accept = Effect.fnUntraced(function* (input: LibraryAcceptBriefProposalRequest) {
      const proposal = yield* pending(input.proposalId);
      const current = yield* catalog.getProject(proposal.projectId);
      if (
        current.revision !== input.expectedRevision ||
        (input.brief === undefined && proposal.baseRevision !== current.revision)
      )
        return yield* conflict();
      const project = yield* catalog.reviseProject({
        requestId: input.requestId,
        projectId: current.id,
        expectedRevision: current.revision,
        title: current.title,
        brief: input.brief ?? proposal.proposedBrief,
        resources: current.resources,
      });
      const accepted = yield* save({
        ...proposal,
        status: "accepted",
        decidedAt: project.updatedAt,
        acceptedRevision: project.revision,
      });
      yield* catalog.appendEvent(
        project.id,
        "brief.revised",
        yield* encode({
          proposalId: proposal.id,
          baseRevision: proposal.baseRevision,
          revision: project.revision,
          summary: proposal.summary,
          source: proposal.source,
          edited: input.brief !== undefined && input.brief !== proposal.proposedBrief,
        }),
        project.updatedAt,
      );
      return { proposal: accepted, project };
    });

    const dismiss = Effect.fnUntraced(function* (input: LibraryDismissBriefProposalRequest) {
      const proposal = yield* pending(input.proposalId);
      return yield* save({ ...proposal, status: "dismissed", decidedAt: yield* now });
    });

    return { propose, list, accept, dismiss };
  });
