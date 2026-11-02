import type { ThreadId } from "@t3tools/contracts";
import {
  DevApiError,
  VaultError,
  type DevApiVariable,
  type DevApiVaultBinding,
  type VaultItemSummary,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as VaultCore from "../vault/VaultCore.ts";
import * as VaultAccess from "../vault/VaultAccess.ts";
export type ApiCredentialCaller =
  | { readonly kind: "agent"; readonly threadId: ThreadId }
  | {
      readonly kind: "client";
      readonly actor: string;
      readonly authorize: Effect.Effect<void, VaultError>;
    };
export class DevApiCredentials extends Context.Service<
  DevApiCredentials,
  {
    readonly resolve: (
      variables: readonly DevApiVariable[],
      caller: ApiCredentialCaller,
    ) => Effect.Effect<
      {
        readonly values: Redacted.Redacted<Readonly<Record<string, string>>>;
        readonly authorize: (url: string) => Effect.Effect<void, DevApiError | VaultError>;
      },
      DevApiError | VaultError
    >;
  }
>()("t3/fork/browser-dev-tools/DevApiCredentials") {}
const origin = (value: string) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      ? url.origin
      : null;
  } catch {
    return null;
  }
};
const make = Effect.gen(function* () {
  const core = yield* VaultCore.VaultCore;
  const access = yield* VaultAccess.VaultAccess;
  const environmentId = yield* (yield* ServerEnvironmentIdentity).getEnvironmentId;
  const resolve = Effect.fn("DevApiCredentials.resolve")(function* (
    variables: readonly DevApiVariable[],
    caller: ApiCredentialCaller,
  ) {
    const values: Record<string, string> = {};
    const held: Array<{ binding: DevApiVaultBinding; item: VaultItemSummary }> = [];
    const authorizeItem = Effect.fn("DevApiCredentials.authorizeItem")(function* (
      binding: DevApiVaultBinding,
    ) {
      if (binding.environmentId !== environmentId || origin(binding.origin) !== binding.origin)
        return yield* new VaultError({ reason: "denied" });
      if (caller.kind === "agent")
        yield* access.require(caller.threadId, binding.itemId, "use", binding.origin);
      else yield* caller.authorize;
      const item = yield* core.inspect(binding.itemId);
      if (!item || item.state !== "active" || item.kind !== "secret")
        return yield* new VaultError({ reason: "not-found" });
      if (binding.version !== null && item.version !== binding.version)
        return yield* new VaultError({ reason: "conflict" });
      return item;
    });
    for (const variable of variables) {
      const binding = variable.vault;
      if (!binding) continue;
      const item = yield* authorizeItem(binding);
      const revealed = yield* access.reveal(
        { id: item.id, expectedVersion: item.version },
        caller.kind === "agent" ? `thread:${caller.threadId}` : caller.actor,
        caller.kind === "agent" ? caller.threadId : undefined,
      );
      const current = yield* authorizeItem(binding);
      if (current.version !== item.version || revealed.item.version !== item.version)
        return yield* new VaultError({ reason: "conflict" });
      values[variable.key] = Redacted.value(revealed.value);
      held.push({ binding, item });
    }
    const authorize = Effect.fn("DevApiCredentials.authorize")(function* (url: string) {
      const destination = origin(url);
      for (const { binding, item } of held) {
        if (destination !== binding.origin)
          return yield* new DevApiError({ reason: "vault-destination" });
        const current = yield* authorizeItem(binding);
        if (current.version !== item.version) return yield* new VaultError({ reason: "conflict" });
      }
    });
    return { values: Redacted.make(values), authorize };
  });
  return DevApiCredentials.of({ resolve });
});
export const layer = Layer.effect(DevApiCredentials, make);
