import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import { LibraryFolderInspection } from "./project-library.ts";

const holder = (projectId: string, ownership: string) => ({
  workingCopyId: `copy-${projectId}`,
  projectId,
  projectTitle: "App",
  ownership,
});
const report = {
  rootPath: "/work/app",
  exists: true,
  repositories: [],
  registration: holder("old", "borrowed"),
  registrations: [holder("old", "borrowed"), holder("current", "borrowed")],
};
const decode = Schema.decodeUnknownSync(LibraryFolderInspection);

// The inspection as clients that predate every holder being reported decode it.
const OlderInspection = Schema.Struct({
  rootPath: Schema.String,
  exists: Schema.Boolean,
  repositories: LibraryFolderInspection.fields.repositories,
  registration: Schema.optional(
    Schema.Struct({
      workingCopyId: Schema.String,
      projectId: Schema.String,
      projectTitle: Schema.String,
      ownership: Schema.Literals(["borrowed", "managed"]),
    }),
  ),
});
const encode = Schema.encodeSync(LibraryFolderInspection);
const decodeOlder = Schema.decodeUnknownSync(OlderInspection);

describe("a folder inspection across Loom versions", () => {
  it("still gives older clients the one holder they judge by", () => {
    const older = decodeOlder(encode(decode(report)));
    expect(older.registration).toEqual(report.registration);
    expect(older).not.toHaveProperty("registrations");
  });

  it("decodes a report from computers that name only one holder", () => {
    const { registrations: _registrations, ...fromOlderComputer } = report;
    expect(decode(fromOlderComputer)).toEqual(fromOlderComputer);
  });

  it("reads ownership a newer computer adds as Loom's files instead of failing the report", () => {
    const decoded = decode({ ...report, registrations: [holder("next", "linked")] });
    expect(decoded.registrations?.[0]?.ownership).toBe("managed");
    expect(decoded.registration?.ownership).toBe("borrowed");
  });
});
