/**
 * The temp directory processes outside a Loom lane use, for sockets they must agree on. Lane
 * shells point TMPDIR into the lane and keep the original in LOOM_LANE_SAVED_TMPDIR, which is
 * empty when TMPDIR was unset.
 */
export function systemTempDir(
  env: Readonly<Record<string, string | undefined>>,
  tempDir: string,
): string {
  const saved = env.LOOM_LANE_SAVED_TMPDIR;
  if (saved === undefined) return tempDir;
  return saved === "" ? "/tmp" : saved;
}
