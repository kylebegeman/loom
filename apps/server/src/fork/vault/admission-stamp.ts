import { VaultError } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const encode = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Array(Schema.NullOr(Schema.String))),
);
// Stable metadata comparison only; never an execution or identity credential.
export const admissionStamp = (fields: ReadonlyArray<string | null>) =>
  encode(fields).pipe(Effect.mapError(() => new VaultError({ reason: "invalid-input" })));
