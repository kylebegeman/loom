import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
class ReadGlbError extends Schema.TaggedError<ReadGlbError>()("ReadGlbError", {
  message: Schema.String,
}) {}
/** Read only the bounded GLB JSON chunk, even for a large board reference. */
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

export const readGlbDocument = (file: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem,
        handle = yield* fs.open(file, { flag: "r" }),
        info = yield* handle.stat;
      const exact = Effect.fn("PcbPreview.readGlbChunk")(function* (n: number) {
        const out = new Uint8Array(n);
        let offset = 0;
        while (offset < n) {
          const data = yield* handle.readAlloc(n - offset);
          if (Option.isNone(data) || !data.value.length)
            return yield* new ReadGlbError({ message: "Truncated board reference." });
          out.set(data.value, offset);
          offset += data.value.length;
        }
        return out;
      });
      const header = yield* exact(20),
        v = new DataView(header.buffer),
        n = v.getUint32(12, true);
      const parse = yield* Effect.try(() => {
        if (
          v.getUint32(0, true) !== 0x46546c67 ||
          v.getUint32(4, true) !== 2 ||
          v.getUint32(8, true) !== Number(info.size) ||
          v.getUint32(16, true) !== 0x4e4f534a ||
          n % 4 !== 0 ||
          n > 16 * 1024 * 1024 ||
          n + 20 > Number(info.size)
        )
          throw new Error("Invalid board reference.");
        return n;
      });
      const bytes = yield* exact(parse);
      const text = yield* Effect.try(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      return yield* decodeJson(text);
    }),
  );
