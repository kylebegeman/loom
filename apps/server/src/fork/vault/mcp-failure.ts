import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

// A failureMode "return" tool sends the agent the JSON of its encoded failure, which carries only
// tags such as reason:"denied". Add each error's fixed message so the agent can read the cause and
// its repair. The tagged fields still decode for the `loom vault` terminal commands.
export const withFailureMessages = <S extends Schema.Codec<Error, unknown>>(errors: S) =>
  Schema.Unknown.pipe(
    Schema.decodeTo(
      Schema.toType(errors),
      SchemaTransformation.transformEffect({
        decode: (value, options) =>
          Schema.decodeUnknownEffect(errors)(value, options).pipe(
            Effect.mapError((error) => error.issue),
          ),
        encode: (error, options) =>
          Schema.encodeEffect(errors)(error, options).pipe(
            Effect.map((fields) =>
              error.message && typeof fields === "object" && fields !== null
                ? { ...fields, message: error.message }
                : fields,
            ),
            Effect.mapError((issue) => issue.issue),
          ),
      }),
    ),
  );
