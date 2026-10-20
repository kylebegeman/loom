import { createVaultCoreAtoms } from "@t3tools/client-runtime/fork";
import type { AtomCommand } from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import { connectionAtomRuntime } from "~/connection/runtime";
import { appAtomRegistry } from "~/rpc/atomRegistry";
export const vault = createVaultCoreAtoms(connectionAtomRuntime);
export async function runVault<W, A, E>(command: AtomCommand<W, A, E>, input: W): Promise<A> {
  const result = await command.run(appAtomRegistry, input);
  if (result._tag === "Failure") throw Cause.squash(result.cause);
  return result.value;
}
