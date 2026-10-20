/**
 * Reads `LOOM_LIBRARY_AUTHORITY` with the same literals `Config.Boolean` accepts, for code that
 * runs without Effect config. Every reader must agree, or part of a server acts as the authority
 * while the rest does not.
 */
export const isLibraryAuthorityEnv = (env: Readonly<Record<string, string | undefined>>) =>
  /^(true|yes|on|1|y)$/.test(env.LOOM_LIBRARY_AUTHORITY ?? "");
