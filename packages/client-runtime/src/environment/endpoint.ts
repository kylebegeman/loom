import { ACCOUNT_ACCESS_PREFIX } from "@t3tools/contracts/fork";
export * from "@t3tools/shared/advertisedEndpoint";

export const environmentEndpointUrl = (httpBaseUrl: string, pathname: string): string => {
  const url = new URL(httpBaseUrl);
  const basePath = url.pathname.startsWith(ACCOUNT_ACCESS_PREFIX)
    ? url.pathname.replace(/\/$/u, "")
    : "";
  url.pathname = `${basePath}${pathname}`;
  url.search = "";
  url.hash = "";
  return url.toString();
};

export const environmentResourceUrl = (httpBaseUrl: string, resource: string): string => {
  const base = new URL(httpBaseUrl);
  const relative =
    base.pathname.startsWith(ACCOUNT_ACCESS_PREFIX) &&
    resource.startsWith("/") &&
    !resource.startsWith("//")
      ? resource.slice(1)
      : resource;
  return new URL(relative, base).href;
};
