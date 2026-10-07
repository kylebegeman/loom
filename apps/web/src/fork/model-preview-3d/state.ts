import { createModelPreviewAtoms } from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { connectionAtomRuntime } from "~/connection/runtime";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { readPreparedConnection } from "~/state/session";
import type { AtomCommand } from "@t3tools/client-runtime/state/runtime";
export const models = createModelPreviewAtoms(connectionAtomRuntime);
export async function runModelCommand<W, A, E>(
  command: AtomCommand<W, A, E>,
  input: W,
): Promise<A> {
  const result = await command.run(appAtomRegistry, input);
  if (result._tag === "Failure") throw Cause.squash(result.cause);
  return result.value;
}
export function modelUrl(environmentId: EnvironmentId, relativeUrl: string) {
  const connection = readPreparedConnection(environmentId);
  if (!connection) throw new Error("The environment is disconnected.");
  return new URL(relativeUrl, connection.httpBaseUrl).href;
}
