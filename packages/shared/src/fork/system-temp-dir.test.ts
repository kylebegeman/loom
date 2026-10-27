import { describe, expect, it } from "vite-plus/test";

import { systemTempDir } from "./system-temp-dir.ts";

describe("systemTempDir", () => {
  it("uses the temp directory a lane shell replaced", () => {
    const env = { LOOM_LANE_SAVED_TMPDIR: "/var/folders/ab/T/" };
    expect(systemTempDir(env, "/Users/me/lanes/app/space/tmp")).toBe("/var/folders/ab/T/");
  });

  it("falls back to /tmp when the lane shell started without TMPDIR", () => {
    expect(systemTempDir({ LOOM_LANE_SAVED_TMPDIR: "" }, "/home/me/lanes/app/space/tmp")).toBe(
      "/tmp",
    );
  });

  it("keeps the process temp directory outside a lane", () => {
    expect(systemTempDir({}, "/var/folders/ab/T")).toBe("/var/folders/ab/T");
  });
});
