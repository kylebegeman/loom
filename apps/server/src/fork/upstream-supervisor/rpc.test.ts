import { expect, it } from "@effect/vitest";
import {
  AuthSessionId,
  AuthStandardClientScopes,
  AuthAccessWriteScope,
  ProjectId,
} from "@t3tools/contracts";
import { UPSTREAM_WS_METHODS, type UpstreamSupervisorConfigInput } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { AuthenticatedSession } from "../../auth/EnvironmentAuth.ts";
import { makeForkRpcAuth } from "../rpcAuthorization.ts";
import * as Upstream from "./UpstreamSupervisor.ts";
import { makeUpstreamRpcHandlers } from "./rpc.ts";

it.effect("only a human administrator session can use the supervisor owner RPCs", () =>
  Effect.gen(function* () {
    const input: UpstreamSupervisorConfigInput = {
      projectId: ProjectId.make("acme"),
      clientSessionId: "chief",
      connection: { id: "a".repeat(32), expectedVersion: 1, repository: "acme/app" },
      enabled: false,
    };
    let saved = 0;
    const dispatchInput = {
      projectId: input.projectId,
      clientRequestId: "one",
      targetTag: "v1.0.0-nightly.1",
      expectedMainSha: "a".repeat(40),
    };
    const service = Layer.mock(Upstream.UpstreamSupervisor)({
      configure: (value, actor) =>
        actor.authorize.pipe(
          Effect.andThen(
            Effect.sync(() => {
              saved++;
              return { ...value, updatedAt: "2026-01-01T00:00:00.000Z" };
            }),
          ),
        ),
      status: (_input, actor) =>
        actor.authorize.pipe(
          Effect.as({
            config: null,
            workflow: "loom-upstream.yml",
            mainSha: null,
            runs: [],
            receipts: [],
          }),
        ),
      dispatch: (_input, actor) =>
        actor.authorize.pipe(
          Effect.as({
            ...dispatchInput,
            id: "b".repeat(64),
            status: "accepted",
            createdAt: "2026-01-01T00:00:00.000Z",
            httpStatus: 204,
            run: null,
          }),
        ),
    });
    for (const subject of [
      "thread:agent",
      "client:hosted",
      "mcp-client",
      "host:worker",
      "human-owner",
    ]) {
      const session: AuthenticatedSession = {
        sessionId: AuthSessionId.make(subject),
        subject,
        method: "browser-session-cookie",
        scopes: AuthStandardClientScopes,
      };
      const handlers = yield* makeUpstreamRpcHandlers(makeForkRpcAuth(session), session).pipe(
        Effect.provide(service),
      );
      for (const operation of [
        handlers[UPSTREAM_WS_METHODS.configure](input).pipe(Effect.asVoid),
        handlers[UPSTREAM_WS_METHODS.status]({ projectId: input.projectId }).pipe(Effect.asVoid),
        handlers[UPSTREAM_WS_METHODS.dispatch](dispatchInput).pipe(Effect.asVoid),
      ]) {
        const result = yield* operation.pipe(Effect.result);
        expect(result._tag).toBe(subject === "human-owner" ? "Success" : "Failure");
      }
    }
    const scoped: AuthenticatedSession = {
      sessionId: AuthSessionId.make("scoped"),
      subject: "scoped-owner",
      method: "browser-session-cookie",
      scopes: [AuthAccessWriteScope],
    };
    const handlers = yield* makeUpstreamRpcHandlers(makeForkRpcAuth(scoped), scoped).pipe(
      Effect.provide(service),
    );
    expect(yield* handlers[UPSTREAM_WS_METHODS.configure](input).pipe(Effect.flip)).toMatchObject({
      reason: "denied",
    });
    expect(saved).toBe(1);
  }),
);
