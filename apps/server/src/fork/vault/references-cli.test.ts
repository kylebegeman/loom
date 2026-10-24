// @effect-diagnostics nodeBuiltinImport:off -- Disposable loopback MCP and real CLI child; no user state or credential manager is used.
import * as NodeHttp from "node:http";
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";
import * as NodeProcess from "node:process";
import { expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import { vaultReferenceText } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import { completeVaultReferences } from "./references-cli.ts";
const entry = (n: number, label = "Dedicated development item") => {
  const environmentId = EnvironmentId.make("completion"),
    id = n.toString(16).padStart(32, "0");
  return {
    environmentId,
    reference: vaultReferenceText(environmentId, id),
    item: {
      id,
      label,
      kind: "account",
      state: "active",
      version: 1,
      createdAt: "2026-10-20T00:00:00Z",
      updatedAt: "2026-10-20T00:00:00Z",
    },
  };
};
const fixture = (reply: (index: number) => unknown, rpcError = false) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const calls: Array<{ name: string; arguments: unknown }> = [];
      const http = NodeHttp.createServer(async (request, response) => {
        if (request.headers.authorization !== "Bearer synthetic-completion") {
          response.writeHead(401).end();
          return;
        }
        let body = "";
        for await (const part of request) body += part;
        const message = JSON.parse(body);
        if (message.method === "notifications/initialized") {
          response.writeHead(202).end();
          return;
        }
        let result;
        if (message.method === "initialize")
          result = {
            protocolVersion: "2025-06-18",
            capabilities: {},
            serverInfo: { name: "synthetic", version: "1" },
          };
        else {
          calls.push(message.params);
          result = reply(calls.length - 1);
        }
        response
          .writeHead(200, { "content-type": "application/json", "mcp-session-id": "synthetic" })
          .end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              ...(rpcError && message.method === "tools/call" ? { error: result } : { result }),
            }),
          );
      });
      await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
      const address = http.address();
      if (!address || typeof address === "string") throw new Error("Missing fixture port");
      return {
        http,
        calls,
        environment: {
          LOOM_MCP_ENDPOINT: `http://127.0.0.1:${address.port}/mcp`,
          LOOM_MCP_AUTHORIZATION: "Bearer synthetic-completion",
        },
      };
    }),
    ({ http }) =>
      Effect.promise(
        () =>
          new Promise<void>((resolve, reject) => http.close((e) => (e ? reject(e) : resolve()))),
      ),
  );

const run = (args: string[], environment: Readonly<Record<string, string | undefined>>) =>
  Effect.promise(
    () =>
      new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = NodeChildProcess.spawn(
          NodeProcess.execPath,
          [NodeURL.fileURLToPath(new URL("../../bin.ts", import.meta.url)), "vault", ...args],
          {
            env: { PATH: "/usr/bin:/bin", NO_COLOR: "1", ...environment },
            stdio: ["ignore", "pipe", "pipe"],
            timeout: 30000,
          },
        );
        let stdout = "",
          stderr = "";
        child.stdout.on("data", (part) => {
          stdout += part;
        });
        child.stderr.on("data", (part) => {
          stderr += part;
        });
        child.once("error", reject);
        child.once("close", (code) => resolve({ code, stdout, stderr }));
      }),
  );

it.effect.each([true, false])(
  "completes canonical references from the authenticated environment across sparse pages (structured=%s)",
  (structured) =>
    Effect.gen(function* () {
      const f = yield* fixture((index) => {
        const result = {
          items: index === 0 ? [] : [entry(2, "Private label\nthat must never be printed")],
          nextCursor: index === 0 ? entry(1).item.id : null,
        };
        return structured
          ? { structuredContent: result }
          : { content: [{ type: "text", text: JSON.stringify(result) }] };
      });
      expect(yield* completeVaultReferences("editor", "account", f.environment)).toEqual([
        entry(2).reference,
      ]);
      expect(f.calls).toEqual(
        [0, 1].map((index) => ({
          name: "loom_vault_references_search",
          arguments: {
            query: "editor",
            kind: "account",
            cursor: index === 0 ? null : entry(1).item.id,
            includeArchived: false,
          },
        })),
      );
    }).pipe(Effect.scoped),
);
it.effect("bounds sparse scans, deduplicates references and caps completion output", () =>
  Effect.gen(function* () {
    const sparse = yield* fixture((index) => ({
      structuredContent: { items: [], nextCursor: entry(index + 1).item.id },
    }));
    expect(yield* completeVaultReferences("missing", null, sparse.environment)).toEqual([]);
    expect(sparse.calls).toHaveLength(4);
    const dense = yield* fixture(() => ({
      structuredContent: {
        items: Array.from({ length: 25 }, (_, n) => entry(n + 1)),
        nextCursor: entry(25).item.id,
      },
    }));
    expect(yield* completeVaultReferences("", null, dense.environment)).toHaveLength(20);
    expect(dense.calls).toHaveLength(1);
    const duplicates = yield* fixture((index) => ({
      structuredContent: {
        items: [entry(1), entry(1)],
        nextCursor: index === 0 ? entry(3).item.id : null,
      },
    }));
    expect(yield* completeVaultReferences("", null, duplicates.environment)).toEqual([
      entry(1).reference,
    ]);
  }).pipe(Effect.scoped),
);
it.effect(
  "refuses tool errors, malformed and forged references, cursor loops and mixed environments without printing them",
  () =>
    Effect.gen(function* () {
      const errors = [
        { isError: true, content: [{ type: "text", text: "synthetic-secret-not-for-output" }] },
        { structuredContent: { items: "invalid" } },
        {
          structuredContent: {
            items: [{ ...entry(1), reference: "$(do-not-run)\nforged" }],
            nextCursor: null,
          },
        },
        {
          structuredContent: {
            items: [{ ...entry(1), item: { ...entry(1).item, state: "archived" } }],
            nextCursor: null,
          },
        },
        {
          structuredContent: {
            items: [
              entry(1),
              {
                ...entry(2),
                environmentId: "other",
                reference: vaultReferenceText(EnvironmentId.make("other"), entry(2).item.id),
              },
            ],
            nextCursor: null,
          },
        },
        { structuredContent: { items: [], nextCursor: entry(1).item.id } },
      ];
      for (const reply of errors) {
        const f = yield* fixture(() => reply);
        const error = yield* completeVaultReferences("", null, f.environment).pipe(Effect.flip);
        expect(error._tag).toBe("ReferenceCompletionError");
        expect(JSON.stringify(error)).not.toContain("synthetic-secret");
        expect(JSON.stringify(error)).not.toContain("do-not-run");
      }
      expect(
        (yield* completeVaultReferences("x".repeat(101), null, {}).pipe(Effect.flip))._tag,
      ).toBe("ReferenceCompletionError");
      expect((yield* completeVaultReferences("", null, {}).pipe(Effect.flip))._tag).toBe(
        "TerminalConnectionError",
      );
    }).pipe(Effect.scoped),
);
it.effect(
  "runs the actual completion CLI and exposes account commands through the same terminal connection",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture(() => ({
        structuredContent: { items: [entry(1, "Label never printed")], nextCursor: null },
      }));
      const completed = yield* run(
        ["references-complete", "editor", "--kind", "account"],
        f.environment,
      );
      expect(completed.code, completed.stderr).toBe(0);
      expect(completed.stdout.trim()).toBe(entry(1).reference);
      expect(completed.stdout + completed.stderr).not.toContain("Label never printed");
      const accounts = yield* run(["test-accounts"], f.environment);
      expect(accounts.code, accounts.stderr).toBe(0);
      expect(f.calls.at(-1)!.name).toBe("loom_vault_test_accounts_discover");
    }).pipe(Effect.scoped),
);

it.effect(
  "keeps failed completion stdout empty for tool, RPC, response and connection failures",
  () =>
    Effect.gen(function* () {
      for (const [reply, rpcError] of [
        [{ isError: true, content: [{ type: "text", text: "synthetic-private-body" }] }, false],
        [{ code: -32603, message: "synthetic-private-body" }, true],
        [{ structuredContent: { items: "invalid" } }, false],
      ] as const) {
        const f = yield* fixture(() => reply, rpcError);
        const result = yield* run(["references-complete"], f.environment);
        expect(result).toEqual({
          code: 1,
          stdout: "",
          stderr:
            "Vault reference completion failed. Check the Loom connection and Vault access policy.\n",
        });
      }
      const result = yield* run(["references-complete"], {});
      expect(result).toEqual({
        code: 1,
        stdout: "",
        stderr:
          "Vault reference completion failed. Check the Loom connection and Vault access policy.\n",
      });
    }).pipe(Effect.scoped),
);

it.effect(
  "keeps parse help out of completion stdout and accepts dash-prefixed queries after --",
  () =>
    Effect.gen(function* () {
      for (const args of [["-query"], ["--kind", "invalid"], ["--unknown-option"]]) {
        const result = yield* run(["references-complete", ...args], {});
        expect(result.code).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr.length).toBeGreaterThan(0);
      }
      const f = yield* fixture(() => ({
        structuredContent: { items: [entry(1)], nextCursor: null },
      }));
      const result = yield* run(
        ["references-complete", "--kind", "account", "--", "-query"],
        f.environment,
      );
      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe(entry(1).reference);
      expect(f.calls[0]!.arguments).toMatchObject({ query: "-query", kind: "account" });
    }).pipe(Effect.scoped),
);
