import type { EnvironmentId } from "@t3tools/contracts";

function validLibraryFileIdentifier(value: string) {
  return /^[A-Za-z0-9._:-]{1,200}$/.test(value) && value !== "." && value !== "..";
}

export function libraryAssetUrl(
  httpBaseUrl: string,
  sourceEnvironmentId: EnvironmentId,
  attachmentId: string,
) {
  if (![sourceEnvironmentId, attachmentId].every(validLibraryFileIdentifier))
    throw new Error("This saved attachment has an invalid identifier.");
  return new URL(
    `/api/loom/library/assets/${sourceEnvironmentId}/${attachmentId}`,
    httpBaseUrl,
  ).toString();
}

export function libraryRecoveryUrl(
  httpBaseUrl: string,
  sourceEnvironmentId: EnvironmentId,
  copyId: string,
  sha256: string,
) {
  if (
    ![sourceEnvironmentId, copyId].every(validLibraryFileIdentifier) ||
    !/^[a-f0-9]{64}$/.test(sha256)
  )
    throw new Error("This recovery archive has an invalid identifier or checksum.");
  return new URL(
    `/api/loom/library/recovery/${sourceEnvironmentId}/${copyId}/${sha256}`,
    httpBaseUrl,
  ).toString();
}
export type LibraryAssetFetch = (
  url: string,
  init: RequestInit,
) => Promise<Pick<Response, "status" | "ok" | "headers" | "body">>;

/** Authorization stays on the library origin; signed storage redirects receive no session headers. */
export async function requestLibraryAsset(
  input: {
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly signal: AbortSignal;
    readonly kind?: "attachment" | "recovery";
  },
  request: LibraryAssetFetch = fetch,
) {
  let response = await request(input.url, {
    headers: input.headers,
    signal: input.signal,
    redirect: "manual",
    credentials: "omit",
  });
  if (response.status === 302) {
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) throw new Error("The library did not return a stored file address.");
    const destination = new URL(location, input.url);
    if (destination.protocol !== "https:" || destination.username || destination.password)
      throw new Error("The library returned an invalid stored attachment address.");
    response = await request(destination.toString(), {
      signal: input.signal,
      redirect: "error",
      credentials: "omit",
    });
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      response.status === 401 || response.status === 403
        ? "Sign in to this library again to open its saved files."
        : response.status === 404
          ? input.kind === "recovery"
            ? "This recovery archive is unavailable in the library. Reload the working copies and try again."
            : "This attachment has not reached the library. Reconnect its original computer and upload history again."
          : "The library cannot open this saved file right now. Reload and try again.",
    );
  }
  return response;
}
