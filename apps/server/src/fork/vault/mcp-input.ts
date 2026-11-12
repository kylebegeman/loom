import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

type ObjectUnion = Schema.Union<
  ReadonlyArray<Schema.Struct<{ readonly [name: string]: Schema.Top }>>
>;

// MCP requires a root object and the server accepts only root arguments the advertised schema
// lists. Advertise one object of every alternative's fields, as T3 does for tagged unions; the
// union still decides which combinations are valid.
export const objectInput = <S extends ObjectUnion>(union: S) => {
  const variants = new Map<string, Array<Schema.Top>>();
  for (const member of union.members) {
    for (const [name, field] of Object.entries(member.fields)) {
      const seen = variants.get(name) ?? [];
      if (!seen.includes(field)) variants.set(name, [...seen, field]);
    }
  }
  const advertised = Schema.Struct(
    Object.fromEntries(
      [...variants].map(([name, [first, ...others]]) => [
        name,
        Schema.optionalKey(
          Schema.toEncoded(others.length === 0 ? first! : Schema.Union([first!, ...others])),
        ),
      ]),
    ),
  );
  return advertised.pipe(
    Schema.decodeTo(union, SchemaTransformation.passthrough({ strict: false })),
  );
};
