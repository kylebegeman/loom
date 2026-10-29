import { describe, expect, it } from "vite-plus/test";
import { LOOM_COMPAT_FLOOR } from "@t3tools/shared/fork/compatibility";
import { computersBelowCompatibilityFloor, directoryServerVersion } from "./compatibility.ts";
import { BOOK, LIBRARY, STUDIO, listing, reported } from "./directory-test-fixtures.ts";

describe("computer compatibility", () => {
  it("names saved and discovered computers once, including the Library, using reported features", () => {
    const directory = listing([
      { ...reported(LIBRARY), loomFeatures: [] },
      { ...reported(BOOK), loomFeatures: LOOM_COMPAT_FLOOR.slice(1) },
      { ...reported(STUDIO), loomFeatures: [...LOOM_COMPAT_FLOOR, "anything-new"] },
    ]);
    const rows = computersBelowCompatibilityFloor({
      listing: directory,
      saved: [
        { environmentId: LIBRARY, label: "My Library", loomFeatures: LOOM_COMPAT_FLOOR },
        { environmentId: LIBRARY, label: "Duplicate" },
        { environmentId: STUDIO, label: "Studio" },
      ],
    });
    expect(
      rows.map((row) => [row.environmentId, row.label, row.missingCompatibilityFeatures]),
    ).toEqual([
      [LIBRARY, "My Library", LOOM_COMPAT_FLOOR],
      [BOOK, reported(BOOK).label, ["project-workflows"]],
    ]);
  });

  it.each(LOOM_COMPAT_FLOOR)("requires %s independently of version or packet flags", (missing) => {
    const report = {
      ...reported(BOOK),
      serverVersion: "999.0.0",
      loomFeatures: LOOM_COMPAT_FLOOR.filter((flag) => flag !== missing),
    };
    expect(
      computersBelowCompatibilityFloor({ listing: listing([report]), saved: [] })[0]
        ?.missingCompatibilityFeatures,
    ).toEqual([missing]);
  });

  it("uses known saved capabilities without a report and leaves unknown computers unclassified", () => {
    const saved = [
      { environmentId: BOOK, label: "Unknown" },
      { environmentId: LIBRARY, label: "Old Library", loomFeatures: [] },
    ];
    expect(
      computersBelowCompatibilityFloor({ listing: null, saved }).map((row) => row.label),
    ).toEqual(["Old Library"]);
    expect(directoryServerVersion(BOOK, listing([reported(BOOK)]))).toBe(
      reported(BOOK).serverVersion,
    );
    expect(directoryServerVersion(STUDIO, listing([reported(BOOK)]))).toBeNull();
  });
});
