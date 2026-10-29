import { mobileAccess } from "../fork/cloudflare-access/mobileAccess"; // fork: cloudflare-access
import type { AssetResource, EnvironmentId } from "@t3tools/contracts";
import type { ImageSource } from "expo-image";

/** Cache immutable attachments by id; signed URLs change on each mint and reconnect. */
export function assetImageSource(
  environmentId: EnvironmentId,
  resource: AssetResource,
  uri: string,
): ImageSource {
  const token = mobileAccess.peekToken(uri);
  const headers = token ? { "Cf-Access-Token": token } : undefined;
  return resource._tag === "attachment"
    ? {
        uri,
        ...(headers ? { headers } : {}),
        cacheKey: `t3-attachment:${JSON.stringify([environmentId, resource.attachmentId])}`,
      }
    : { uri, ...(headers ? { headers } : {}) };
}
