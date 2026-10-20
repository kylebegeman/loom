import type { ThreadId } from "@t3tools/contracts";
import {
  VaultError,
  VaultReferenceSearch,
  type VaultReference,
  type VaultReferencePage,
  vaultReferenceText,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as VaultCore from "./VaultCore.ts";
import * as VaultAccess from "./VaultAccess.ts";
export class VaultReferences extends Context.Service<
  VaultReferences,
  {
    readonly search: (
      input: VaultReferenceSearch,
      threadId?: ThreadId,
    ) => Effect.Effect<VaultReferencePage, VaultError>;
    readonly describe: (
      id: string,
      threadId?: ThreadId,
    ) => Effect.Effect<VaultReference | null, VaultError>;
  }
>()("t3/fork/vault/VaultReferences") {}
const isSearch = Schema.is(VaultReferenceSearch);
const make = Effect.gen(function* () {
  const core = yield* VaultCore.VaultCore,
    access = yield* VaultAccess.VaultAccess,
    identity = yield* ServerEnvironmentIdentity;
  const environmentId = yield* identity.getEnvironmentId;
  const reference = (item: VaultReference["item"]): VaultReference => ({
    environmentId,
    item,
    reference: vaultReferenceText(environmentId, item.id),
  });
  return VaultReferences.of({
    search: Effect.fn("VaultReferences.search")(function* (input, threadId) {
      if (!isSearch(input)) return yield* new VaultError({ reason: "invalid-input" });
      const query = input.query.trim().toLocaleLowerCase();
      const items: VaultReference[] = [];
      let cursor = input.cursor;
      // Scan at most 100 records per request; sparse matches continue through the returned cursor.
      for (let page = 0; page < 4; page++) {
        const request = { cursor, includeArchived: input.includeArchived };
        const result = yield* threadId
          ? access.listForThread(request, threadId)
          : core.list(request);
        for (const item of result.items)
          if (
            (!input.kind || item.kind === input.kind) &&
            (!query ||
              item.label.toLocaleLowerCase().includes(query) ||
              item.id.includes(query) ||
              vaultReferenceText(environmentId, item.id).toLocaleLowerCase() === query)
          )
            items.push(reference(item));
        cursor = result.nextCursor;
        if (!cursor || items.length > 0) break;
      }
      return { items, nextCursor: cursor };
    }),
    describe: Effect.fn("VaultReferences.describe")(function* (id, threadId) {
      if (!/^[a-f0-9]{32}$/.test(id)) return yield* new VaultError({ reason: "invalid-input" });
      if (threadId) {
        const allowed = yield* access.require(threadId, id, "inspect", null).pipe(
          Effect.as(true),
          Effect.catchTags({
            VaultError: (error) =>
              error.reason === "denied" || error.reason === "not-found"
                ? Effect.succeed(false)
                : Effect.fail(error),
          }),
        );
        if (!allowed) return null;
      }
      const item = yield* core.inspect(id);
      return item ? reference(item) : null;
    }),
  });
});
export const layer = Layer.effect(VaultReferences, make);
