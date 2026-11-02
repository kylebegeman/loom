import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Stream from "effect/Stream";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "@effect/vitest";
import { candidatesFrom, checkoutKey, appendOutput, commandLine } from "./servers.ts";

describe("checkout dev servers", () => {
  it("keeps checkout identities independent and discovers runnable scripts without duplicates", () => {
    expect(checkoutKey("/work/a")).not.toBe(checkoutKey("/work/b"));
    const candidates = candidatesFrom({
      actions: [
        { id: "dev", name: "App", command: "pnpm run dev", previewUrl: "http://localhost:3000" },
      ],
      scripts: { dev: "vite", "dev:api": "node api.js", test: "vitest", start: "node server.js" },
      packageManager: "pnpm",
      mappedDev: "pnpm run dev",
    });
    expect(candidates.map((entry) => entry.command)).toEqual([
      "pnpm run dev",
      "pnpm run dev:api",
      "pnpm run start",
    ]);
    expect(candidates[0]?.previewUrl).toBe("http://localhost:3000");
    expect(
      candidatesFrom({ actions: [], scripts: { "dev:app": "vite" }, packageManager: "npm" })[0]
        ?.command,
    ).toBe("npm run dev:app");
  });
  it("bounds output and quotes commands without expanding their contents in the parent shell", () => {
    expect(appendOutput("a".repeat(9000), "tail").length).toBe(8192);
    expect(appendOutput("a".repeat(9000), "tail").endsWith("tail")).toBe(true);
    expect(commandLine("node server.js", "win32")).toContain("node server.js");
  });
  it.live("retains a parent shell for process ownership and returns the command exit code", () =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const command = `'${process.execPath}' -e 'console.log(process.pid); process.exit(7)'`;
      const child = yield* spawner.spawn(
        ChildProcess.make("sh", ["-c", commandLine(command, "linux").trim()]),
      );
      const chunks = yield* Stream.runCollect(child.stdout);
      const output = Buffer.concat(chunks).toString();
      expect(yield* child.exitCode).toBe(7);
      expect(Number(output.trim())).not.toBe(child.pid);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
