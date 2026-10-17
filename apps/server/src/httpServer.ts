// @effect-diagnostics nodeBuiltinImport:off
import * as NodeHttp from "node:http";
import { guardHttpResponseWriteErrors } from "./httpResponseErrorGuard.ts";

/** Keep pooled proxy connections valid until Caddy's two-minute idle limit. */
export const createHttpServer = () =>
  guardHttpResponseWriteErrors(NodeHttp.createServer({ keepAliveTimeout: 130_000 }));
