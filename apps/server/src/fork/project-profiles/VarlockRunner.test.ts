import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as ProcessRunner from "../../processRunner.ts";
import * as Varlock from "./VarlockRunner.ts";
it.effect(
  "runs only explicit load, opts out of telemetry and returns redacted exit-one errors",
  () =>
    Effect.gen(function* () {
      const calls: ProcessRunner.ProcessRunInput[] = [];
      const runner = {
        run: (input: ProcessRunner.ProcessRunInput) => {
          calls.push(input);
          return Effect.succeed({
            stdout:
              input.args[0] === "--version"
                ? "varlock 1.20.0"
                : '{"config":{"TOKEN":{"value":"private-fixture"}},"errors":{"configItems":{"TOKEN":"Invalid private-fixture"}}}',
            stderr: "do not expose this",
            code: input.args[0] === "--version" ? 0 : 1,
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
            stdoutInvalidUtf8: false,
            stderrInvalidUtf8: false,
          } as ProcessRunner.ProcessRunOutput);
        },
      };
      const program = Effect.gen(function* () {
        const service = yield* Varlock.VarlockRunner;
        expect((yield* service.detect)._tag).toBe("available");
        yield* service.detect;
        expect(calls).toHaveLength(1);
        const report = yield* service.validate("/checkout");
        expect(report.itemErrors).toEqual({ TOKEN: "Invalid [value]" });
        expect(calls[1]).toMatchObject({
          command: "varlock",
          args: ["load", "--format", "json-full", "--agent", "--compact"],
          cwd: "/checkout",
          env: { VARLOCK_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" },
          timeout: "60 seconds",
        });
        expect(JSON.stringify(report)).not.toContain("private-fixture");
      });
      yield* program.pipe(
        Effect.provide(Varlock.layer),
        Effect.provideService(
          ProcessRunner.ProcessRunner,
          runner as ProcessRunner.ProcessRunner["Service"],
        ),
      );
    }),
);
