// @effect-diagnostics nodeBuiltinImport:off -- Local HTTP protocol verification.
import * as NodeHttp from "node:http";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { callForkTool } from "./callTool.ts";

const server = (failed = false) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const calls: unknown[] = [];
      const http = NodeHttp.createServer(async (request, response) => {
        expect(request.headers.authorization).toBe("Bearer test-only");
        let body = "";
        for await (const chunk of request) body += chunk;
        const message = JSON.parse(body) as { method: string; id?: string; params?: unknown };
        if (message.method === "notifications/initialized") {
          response.writeHead(202).end();
          return;
        }
        if (message.method === "tools/call") calls.push(message.params);
        response
          .writeHead(200, { "content-type": "application/json", "mcp-session-id": "test" })
          .end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              result:
                message.method === "initialize"
                  ? {
                      protocolVersion: "2025-06-18",
                      capabilities: {},
                      serverInfo: { name: "test", version: "1" },
                    }
                  : { isError: failed, content: [{ type: "text", text: "test result" }] },
            }),
          );
      });
      await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
      const address = http.address();
      if (!address || typeof address === "string") throw new Error("No test port");
      return { http, endpoint: `http://127.0.0.1:${address.port}/mcp`, calls };
    }),
    ({ http }) =>
      Effect.promise(
        () =>
          new Promise<void>((resolve, reject) =>
            http.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
it.effect("uses the configured MCP boundary for PCB and 3D calls", () =>
  Effect.gen(function* () {
    const { endpoint, calls } = yield* server();
    yield* callForkTool("loom_pcb_inspect", '{"designId":"board.kicad_pcb"}', {
      LOOM_MCP_ENDPOINT: endpoint,
      LOOM_MCP_AUTHORIZATION: "Bearer test-only",
    });
    yield* callForkTool("loom_model_preview_3d_workspace", '{"path":"case.scad"}', {
      T3_ACP_MCP_ENDPOINT: endpoint,
      T3_ACP_MCP_AUTHORIZATION: "Bearer test-only",
    });
    expect(calls).toEqual([
      { name: "loom_pcb_inspect", arguments: { designId: "board.kicad_pcb" } },
      { name: "loom_model_preview_3d_workspace", arguments: { path: "case.scad" } },
    ]);
  }).pipe(Effect.scoped),
);
it.effect("fails the CLI operation when MCP reports a tool error", () =>
  Effect.gen(function* () {
    const { endpoint } = yield* server(true);
    const error = yield* callForkTool("loom_pcb_render", "{}", {
      LOOM_MCP_ENDPOINT: endpoint,
      LOOM_MCP_AUTHORIZATION: "Bearer test-only",
    }).pipe(Effect.flip);
    expect(error).toMatchObject({
      message: "The Loom tool failed. See the JSON result for details.",
    });
  }).pipe(Effect.scoped),
);
it.effect("rejects non-object arguments before making a tool request", () =>
  Effect.gen(function* () {
    const { endpoint, calls } = yield* server();
    yield* callForkTool("loom_pcb_list", "[]", {
      LOOM_MCP_ENDPOINT: endpoint,
      LOOM_MCP_AUTHORIZATION: "Bearer test-only",
    }).pipe(Effect.flip);
    expect(calls).toEqual([]);
  }).pipe(Effect.scoped),
);
