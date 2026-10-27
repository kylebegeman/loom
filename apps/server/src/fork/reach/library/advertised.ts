import { directoryAdvertised } from "../../directory/advertised.ts";
import { reachLibraryConfig } from "./credentials.ts";

/**
 * The Library advertises `reach-library`, its records list, once its directory runs and it can
 * hold records: its zone and Cloudflare token file are named, or Loom Identity and its Pocket ID
 * key file are, which Prepare sign-in needs without a zone. Whether a file is readable is
 * reported by the list, so a broken file shows up there instead of hiding the feature.
 */
export const reachLibraryAdvertised = (env: Readonly<Record<string, string | undefined>>) => {
  const config = reachLibraryConfig(env);
  const { issuer, nativeClientId, adminKeyFile } = config.identity;
  return (
    directoryAdvertised(env) &&
    ((config.zone !== null && config.cloudflareTokenFile !== null) ||
      (issuer !== null && nativeClientId !== null && adminKeyFile !== null))
  );
};
