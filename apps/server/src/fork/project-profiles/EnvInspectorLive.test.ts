// @effect-diagnostics nodeBuiltinImport:off - Temporary fixture files exercise checkout containment.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Inspector from "./EnvInspectorLive.ts";
it.effect(
  "rejects traversal, escaping symlinks and oversized files; previews an empty checkout",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* Effect.acquireRelease(
          Effect.promise(() =>
            NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-env-profile-")),
          ),
          (dir) => Effect.promise(() => NodeFSP.rm(dir, { recursive: true, force: true })),
        );
        const inspector = yield* Inspector.EnvInspector;
        expect((yield* inspector.inspect(root, ".env.schema")).schema._tag).toBe("absent");
        expect((yield* Effect.flip(inspector.inspect(root, "../outside.schema"))).reason).toBe(
          "path-outside-checkout",
        );
        expect((yield* Effect.flip(inspector.inspect(root, "/etc/passwd"))).reason).toBe(
          "path-outside-checkout",
        );
        yield* Effect.promise(() =>
          NodeFSP.symlink(NodeOS.tmpdir(), NodePath.join(root, "outside")),
        );
        yield* Effect.promise(() =>
          NodeFSP.writeFile(NodePath.join(root, ".env.schema"), "# @import(./outside)\n\nKEY=\n"),
        );
        expect((yield* Effect.flip(inspector.inspect(root, ".env.schema"))).reason).toBe(
          "path-outside-checkout",
        );
        yield* Effect.promise(() =>
          NodeFSP.writeFile(NodePath.join(root, ".env.schema"), "A".repeat(256 * 1024 + 1)),
        );
        expect((yield* Effect.flip(inspector.inspect(root, ".env.schema"))).reason).toBe(
          "file-too-large",
        );
      }),
    ).pipe(Effect.provide(Inspector.layer.pipe(Layer.provide(NodeServices.layer)))),
);
