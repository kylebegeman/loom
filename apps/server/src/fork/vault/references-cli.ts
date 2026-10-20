// @effect-diagnostics nodeBuiltinImport:off -- CLI boundary prints safe canonical references, never credentials or server error bodies.
import * as NodeProcess from "node:process";
import { Argument, Command, Flag } from "effect/cli";
import { VaultItemKind, VaultReferencePage, vaultReferenceText } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Console from "effect/Console";
import { callAcpMcpTool } from "../../mcp/AcpMcpStdioBridge.ts";
import { readTerminalConnection } from "./TerminalConnection.ts";

class ReferenceCompletionError extends Schema.TaggedError<ReferenceCompletionError>()(
  "ReferenceCompletionError",
  {
    reason: Schema.Literals(["input", "response", "tool"]),
  },
) {
  override get message() {
    return this.reason === "input"
      ? "Use a query of at most 100 characters and a supported Vault kind."
      : this.reason === "tool"
        ? "Vault reference completion was refused. Check the authenticated connection and inspect grants."
        : "The Loom server returned an unsupported reference completion result.";
  }
}
const envelope = Schema.decodeUnknownOption(
  Schema.Struct({
    isError: Schema.optionalKey(Schema.Boolean),
    structuredContent: Schema.optionalKey(Schema.Unknown),
    content: Schema.optionalKey(
      Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.optionalKey(Schema.String) })),
    ),
  }),
);
const isKind = Schema.is(VaultItemKind);
const page = Schema.decodeUnknownOption(VaultReferencePage);
const textPage = Schema.decodeUnknownOption(Schema.fromJsonString(VaultReferencePage));
export const completeVaultReferences = Effect.fn("completeVaultReferences")(function* (
  query: string,
  kind: typeof VaultItemKind.Type | null,
  environment: Readonly<Record<string, string | undefined>>,
) {
  if (query.length > 100 || (kind !== null && !isKind(kind)))
    return yield* new ReferenceCompletionError({ reason: "input" });
  const connection = yield* readTerminalConnection(environment);
  const references = new Set<string>(),
    cursors = new Set<string>();
  let cursor: string | null = null,
    environmentId: string | null = null;
  // Completion is deliberately bounded. Explicit paged search remains available for a large vault.
  for (let request = 0; request < 4; request++) {
    const response = envelope(
      yield* callAcpMcpTool({
        ...connection,
        tool: "loom_vault_references_search",
        arguments: { query, kind, cursor, includeArchived: false },
      }),
    );
    if (Option.isNone(response)) return yield* new ReferenceCompletionError({ reason: "response" });
    if (response.value.isError) return yield* new ReferenceCompletionError({ reason: "tool" });
    const result =
      response.value.structuredContent !== undefined
        ? page(response.value.structuredContent)
        : (response.value.content ?? []).reduce<Option.Option<typeof VaultReferencePage.Type>>(
            (found, item) =>
              Option.isSome(found)
                ? found
                : item.type === "text" && item.text
                  ? textPage(item.text)
                  : Option.none(),
            Option.none(),
          );
    if (Option.isNone(result) || result.value.items.length > 25)
      return yield* new ReferenceCompletionError({ reason: "response" });
    for (const item of result.value.items) {
      if (
        item.item.state !== "active" ||
        (kind !== null && item.item.kind !== kind) ||
        item.reference !== vaultReferenceText(item.environmentId, item.item.id) ||
        (environmentId !== null && item.environmentId !== environmentId)
      )
        return yield* new ReferenceCompletionError({ reason: "response" });
      environmentId = item.environmentId;
      references.add(item.reference);
    }
    cursor = result.value.nextCursor;
    if (!cursor || references.size >= 20) break;
    if (cursors.has(cursor)) return yield* new ReferenceCompletionError({ reason: "response" });
    cursors.add(cursor);
  }
  return [...references].slice(0, 20);
});
export const referencesCompleteCommand = Command.make("references-complete", {
  query: Argument.String("query").pipe(Argument.withDefault("")),
  kind: Flag.Literals("kind", VaultItemKind.literals).pipe(Flag.optional),
}).pipe(
  Command.withDescription(
    "Print up to 20 active, inspect-authorized canonical references for shell completion. Uses only this terminal's authenticated Loom environment; never prints labels or credentials.",
  ),
  Command.withHandler(({ query, kind }) =>
    Effect.gen(function* () {
      const values = yield* completeVaultReferences(query, Option.getOrNull(kind), NodeProcess.env);
      if (values.length) yield* Console.log(values.join("\n"));
    }),
  ),
);
