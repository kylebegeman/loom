import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { decodeSshAgentInput } from "./ssh-agent-input.ts";
const request = {
  id: "a".repeat(32),
  expectedVersion: 1,
  command: { tool: "ssh", argv: ["personal-vps", "true"] },
  timeoutMs: 600_000,
};
it.effect("accepts long command deadlines independently of the signing lease", () =>
  Effect.gen(function* () {
    expect((yield* decodeSshAgentInput(JSON.stringify(request))).timeoutMs).toBe(600_000);
  }),
);
it.effect("reports schema paths and limits without exposing inputs or unexpected keys", () =>
  Effect.gen(function* () {
    for (const [input, expected] of [
      ["{sensitive-broken-json", "valid JSON"],
      [JSON.stringify({ ...request, timeoutMs: 86_400_001 }), "86400000"],
      [
        JSON.stringify({ ...request, "secret-key-canary": "secret-value-canary" }),
        "Unexpected field",
      ],
      [
        JSON.stringify({
          ...request,
          command: { tool: "ssh", argv: ["secret-value-canary".repeat(300)] },
        }),
        "command.argv[0]",
      ],
    ]) {
      const failure = yield* decodeSshAgentInput(input!).pipe(Effect.flip);
      expect(failure.message).toContain(expected);
      expect(failure.message).not.toContain("canary");
      expect(failure.message).not.toContain("sensitive-broken-json");
    }
  }),
);
