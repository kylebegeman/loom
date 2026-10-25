import { directoryAdvertised } from "../../directory/advertised.ts";
import { reachLibraryConfig } from "./credentials.ts";

/**
 * The Library advertises `reach-library` once its directory runs and both its zone and its
 * Cloudflare token file are named. Whether the file is readable is reported by the admin list,
 * so a broken file shows up there instead of hiding the feature.
 */
export const reachLibraryAdvertised = (env: Readonly<Record<string, string | undefined>>) => {
  const config = reachLibraryConfig(env);
  return directoryAdvertised(env) && config.zone !== null && config.cloudflareTokenFile !== null;
};
