import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { PcbProjectSettings, type PcbUpdateProjectSettingsInput } from "@t3tools/contracts/fork";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";

const SettingsFile = Schema.fromJsonString(
  Schema.Struct({ projects: Schema.Record(Schema.String, PcbProjectSettings) }),
);
const encodeKey = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Schema.String)));
const waiverKey = (designId: string, findingId: string) => encodeKey([designId, findingId]);
const encodeSettings = Schema.encodeEffect(SettingsFile);
const defaults = (): PcbProjectSettings => ({
  autoChecks: { erc: false, drc: false, review: false },
  review: { rules: {}, params: {}, waivers: [] },
});
/** Project opt-in lives on the host, so all clients and agent reads share the same policy. */
export const makeProjectSettings = Effect.fn("PcbPreview.makeProjectSettings")(function* (
  file: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const lock = yield* Semaphore.make(1);
  let logged = false;
  const read = Effect.gen(function* () {
    if (!(yield* fs.exists(file))) return { projects: {} } as typeof SettingsFile.Type;
    return yield* fs
      .readFileString(file)
      .pipe(Effect.flatMap(Schema.decodeUnknownEffect(SettingsFile)));
  });
  const get = (projectId: string) =>
    read.pipe(
      Effect.map((data) => data.projects[projectId] ?? defaults()),
      Effect.catch(() =>
        Effect.gen(function* () {
          if (!logged) {
            logged = true;
            yield* Effect.logWarning("PCB project settings could not be read; using defaults.");
          }
          return defaults();
        }),
      ),
    );
  const update = (projectId: string, patch: PcbUpdateProjectSettingsInput) =>
    lock.withPermit(
      Effect.gen(function* () {
        // A corrupt or inaccessible existing file must not silently erase other projects on write.
        const data = yield* read;
        const current = data.projects[projectId] ?? defaults();
        const at = DateTime.formatIso(yield* DateTime.now);
        const waivers = new Map(
          current.review.waivers.map((w) => [waiverKey(w.designId, w.findingId), w]),
        );
        for (const w of patch.review?.waive ?? [])
          waivers.set(waiverKey(w.designId, w.findingId), { ...w, at });
        for (const w of patch.review?.unwaive ?? [])
          waivers.delete(waiverKey(w.designId, w.findingId));
        const params = { ...current.review.params };
        for (const [rule, values] of Object.entries(patch.review?.params ?? {}))
          params[rule] = { ...params[rule], ...values };
        const next = {
          ...current,
          review: {
            rules: { ...current.review.rules, ...patch.review?.rules },
            params,
            waivers: [...waivers.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-2000),
          },
          autoChecks: {
            review: patch.autoChecks?.review ?? current.autoChecks.review,
            erc: patch.autoChecks?.erc ?? current.autoChecks.erc,
            drc: patch.autoChecks?.drc ?? current.autoChecks.drc,
          },
        };
        yield* writeFileStringAtomically({
          filePath: file,
          contents: yield* encodeSettings({
            projects: { ...data.projects, [projectId]: next },
          }),
        });
        return next;
      }),
    );
  return { get, update };
});
