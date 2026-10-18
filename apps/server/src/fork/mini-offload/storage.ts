// @effect-diagnostics nodeBuiltinImport:off - Mini receipts and the worker registry are private files on the host.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { MiniOffloadError } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";

export const disk = <A>(action: () => Promise<A>) =>
  Effect.tryPromise({
    try: action,
    catch: (cause) => new MiniOffloadError({ reason: "storage", cause }),
  });
export const readJson = async (path: string): Promise<unknown | null> => {
  try {
    return JSON.parse(await NodeFSP.readFile(path, "utf8"));
  } catch (cause) {
    if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT")
      return null;
    throw cause;
  }
};
export const atomicJson = async (path: string, value: unknown) => {
  const temporary = path + "." + NodeCrypto.randomUUID() + ".tmp";
  const file = await NodeFSP.open(temporary, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(value));
    await file.sync();
  } finally {
    await file.close();
  }
  await NodeFSP.rename(temporary, path);
  const directory = await NodeFSP.open(NodePath.dirname(path), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
};
