import { isLibraryAuthorityEnv } from "../project-library/authority.ts";

/** The https origin of a URL, or null for anything else. */
export const httpsOrigin = (value: string): string | null => {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
};

/**
 * Only a Library authority with a public https identity callback runs the directory, so only it
 * advertises the slug. Reports are signed for that callback's origin.
 */
export const directoryAdvertised = (env: Readonly<Record<string, string | undefined>>) =>
  isLibraryAuthorityEnv(env) && httpsOrigin(env.LOOM_IDENTITY_REDIRECT_URI ?? "") !== null;
