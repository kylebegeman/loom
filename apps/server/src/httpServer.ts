// @effect-diagnostics nodeBuiltinImport:off
import * as NodeHttp from "node:http";
import { guardHttpResponseWriteErrors, keepIdleConnections } from "./httpResponseErrorGuard.ts";

/** Keep pooled proxy connections valid until Caddy's two-minute idle limit. */
export const createHttpServer = () => {
  const server = keepIdleConnections(guardHttpResponseWriteErrors(NodeHttp.createServer()));
  // Set after keepIdleConnections, which installs upstream's shorter 95-second default.
  server.keepAliveTimeout = 130_000;
  return server;
};
