import type { DevHttpRequest } from "@t3tools/contracts/fork";

export const HTTP_BODY_LIMIT = 262144;
export const HTTP_HISTORY_LIMIT = 50;
const sensitive =
  /^(authorization|proxy-authorization|cookie|set-cookie)$|(^|[-_])(api[-_]?key|token|secret|password)$/i;
const sensitiveQuery = /^(.*token|.*secret|.*password|.*signature|api[-_]?key|key|auth|code)$/i;
export const redactHeaders = (headers: Readonly<Record<string, string>>) =>
  Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      sensitive.test(name) ? "[redacted]" : value.slice(0, 8192),
    ]),
  );
export function redactRequest(request: DevHttpRequest): DevHttpRequest {
  const url = new URL(request.url);
  url.username = "";
  url.password = "";
  for (const name of new Set(url.searchParams.keys()))
    if (sensitiveQuery.test(name)) url.searchParams.set(name, "[redacted]");
  return { ...request, url: url.toString(), headers: redactHeaders(request.headers) };
}
export function validRequest(request: DevHttpRequest): boolean {
  try {
    const url = new URL(request.url);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !(["GET", "HEAD"].includes(request.method) && request.body.length > 0) &&
      (request.bodyEncoding === "base64"
        ? /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(request.body) &&
          Buffer.byteLength(request.body, "base64") <= 131072
        : new TextEncoder().encode(request.body).length <= 131072) &&
      Object.keys(request.headers).length <= 64 &&
      Object.entries(request.headers).every(
        ([name, value]) =>
          /^[!#$%&'*+.^_`|~\w-]+$/.test(name) &&
          value.length <= 8192 &&
          !/[\r\n\0]/.test(value) &&
          !/^(host|content-length|transfer-encoding|connection|upgrade|proxy-connection|trailer|te)$/i.test(
            name,
          ),
      )
    );
  } catch {
    return false;
  }
}
export const textContent = (type: string) =>
  /^(text\/|application\/(.*\+)?(json|xml)|application\/(javascript|x-www-form-urlencoded)|image\/svg\+xml)/i.test(
    type,
  );
