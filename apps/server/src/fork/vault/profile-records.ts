import * as Schema from "effect/Schema";

export {
  VaultProfileRegistryRecord as Registry,
  VaultProfileRunRecord as Pin,
  VaultProfileRetiredRecord as RetiredPin,
} from "@t3tools/contracts/fork";
export const encodeRunKey = Schema.encodeEffect(
  Schema.fromJsonString(
    Schema.Struct({ threadId: Schema.String, runId: Schema.NullOr(Schema.String) }),
  ),
);
