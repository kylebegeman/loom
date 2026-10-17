// @effect-diagnostics nodeBuiltinImport:off
import * as NodeHttp from "node:http";
import * as NodeNet from "node:net";
import { expect, it } from "vite-plus/test";
import { createHttpServer } from "./httpServer.ts";

it("keeps upstream connections alive beyond the reverse proxy's two-minute pool", async () => {
  const server = createHttpServer();
  server.on("request", (_request, response) => response.end("ok"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as NodeNet.AddressInfo).port;
  const agent = new NodeHttp.Agent({ keepAlive: true });
  try {
    const headers = await new Promise<NodeHttp.IncomingHttpHeaders>((resolve, reject) => {
      NodeHttp.get({ host: "127.0.0.1", port, agent }, (response) => {
        response.resume();
        response.on("end", () => resolve(response.headers));
      }).on("error", reject);
    });
    const timeout = Number(/timeout=(\d+)/.exec(String(headers["keep-alive"]))?.[1]);
    expect(timeout).toBeGreaterThan(120);
  } finally {
    agent.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
