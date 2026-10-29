// @effect-diagnostics globalTimers:off -- Native fetch boundaries need bounded requests on both Electron and React Native.
import * as Schema from "effect/Schema";
import { LOOM_IDENTITY_METADATA_PATH } from "@t3tools/contracts/fork";

const Grant = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.String,
  expiresAt: Schema.Number,
});
const Client = Schema.Struct({
  origin: Schema.String,
  issuer: Schema.String,
  clientId: Schema.String,
  redirectUri: Schema.String,
  grant: Schema.optional(Grant),
});
export type CloudflareAccessClient = typeof Client.Type;
const Document = Schema.Struct({ version: Schema.Literal(1), clients: Schema.Array(Client) });
const decodeDocument = Schema.decodeUnknownSync(Schema.fromJsonString(Document));

class CloudflareAccessError extends Error {
  readonly reason:
    | "storage"
    | "configuration"
    | "network"
    | "sign-in-required"
    | "response"
    | "cancelled";
  constructor(reason: CloudflareAccessError["reason"]) {
    super(
      {
        storage: "Could not use this device's protected Access sign-in storage. Try again.",
        configuration: "This computer's Cloudflare Access configuration could not be verified.",
        network: "Could not reach Cloudflare Access. Your saved sign-in is retained. Try again.",
        "sign-in-required": "Sign in to this computer again to renew Cloudflare Access.",
        response: "Cloudflare Access returned an unsupported sign-in response.",
        cancelled: "Cloudflare Access sign-in was cancelled.",
      }[reason],
    );
    this.name = "CloudflareAccessError";
    this.reason = reason;
  }
}

function originOf(value: string) {
  const url = new URL(value);
  if (url.protocol === "wss:") url.protocol = "https:";
  if (url.protocol === "ws:") url.protocol = "http:";
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
    throw new CloudflareAccessError("configuration");
  return url.origin;
}

function transportOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return ["http:", "https:", "ws:", "wss:"].includes(url.protocol) ? originOf(value) : null;
  } catch {
    return null;
  }
}

function validClient(value: CloudflareAccessClient) {
  try {
    return (
      value.origin === originOf(value.origin) &&
      value.origin.startsWith("https://") &&
      /^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/u.test(value.issuer) &&
      value.clientId.length > 0 &&
      value.clientId.length <= 1024 &&
      validRedirect(value.redirectUri) &&
      (!value.grant ||
        (value.grant.accessToken.length > 0 &&
          value.grant.accessToken.length <= 32768 &&
          value.grant.refreshToken.length > 0 &&
          value.grant.refreshToken.length <= 32768 &&
          Number.isFinite(value.grant.expiresAt) &&
          value.grant.expiresAt > 0))
    );
  } catch {
    return false;
  }
}

function validRedirect(value: string) {
  return (
    (/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/loom\/access\/callback$/u.test(value) &&
      Number(new URL(value).port) <= 65535) ||
    value === "loom://access-auth" ||
    value === "loom-dev://access-auth"
  );
}

export interface CloudflareAccessTicket {
  readonly registration: CloudflareAccessClient;
  readonly attempt: number;
}

/** Refresh credentials belong in OS-protected storage, never the connection catalog or renderer. */
export function makeCloudflareAccess(options: {
  readonly storage: {
    readonly read: () => Promise<string | null>;
    readonly write: (value: string) => Promise<void>;
  };
  readonly fetch: typeof globalThis.fetch;
  readonly now: () => number;
}) {
  let clients: Map<string, CloudflareAccessClient> | undefined;
  let dirty = false;
  let tail: Promise<unknown> = Promise.resolve();
  let nextAttempt = 0;
  const active = new Map<string, number>();
  const exclusive = <A>(operation: () => Promise<A>): Promise<A> => {
    const next = tail.then(operation, operation);
    tail = next.catch(() => undefined);
    return next;
  };
  const save = async () => {
    dirty = true;
    try {
      await options.storage.write(JSON.stringify({ version: 1, clients: [...clients!.values()] }));
    } catch {
      throw new CloudflareAccessError("storage");
    }
    dirty = false;
  };
  const load = async () => {
    if (!clients) {
      try {
        const raw = await options.storage.read();
        const stored = raw === null ? [] : decodeDocument(raw).clients;
        if (
          stored.some((c) => !validClient(c)) ||
          new Set(stored.map((c) => c.origin)).size !== stored.length
        )
          throw new CloudflareAccessError("storage");
        clients = new Map(stored.map((c) => [c.origin, c]));
      } catch {
        throw new CloudflareAccessError("storage");
      }
    }
    if (dirty) await save();
    return clients;
  };
  const jsonRequest = async (url: string, init: RequestInit = {}) => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 15000);
    try {
      const response = await options.fetch(url, {
        ...init,
        redirect: "error",
        credentials: "omit",
        signal: abort.signal,
      });
      const text = await response.text();
      if (text.length > 131072) throw new CloudflareAccessError("response");
      let body: unknown;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      return { response, body };
    } catch (error) {
      if (error instanceof CloudflareAccessError) throw error;
      throw new CloudflareAccessError("network");
    } finally {
      clearTimeout(timer);
    }
  };
  const form = (values: Record<string, string>): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values),
  });
  const withoutGrant = ({
    grant: _grant,
    ...value
  }: CloudflareAccessClient): CloudflareAccessClient => value;
  const readGrant = (body: unknown) => {
    if (
      !body ||
      typeof body !== "object" ||
      !("access_token" in body) ||
      typeof body.access_token !== "string" ||
      !body.access_token ||
      body.access_token.length > 32768 ||
      !("refresh_token" in body) ||
      typeof body.refresh_token !== "string" ||
      !body.refresh_token ||
      body.refresh_token.length > 32768 ||
      !("token_type" in body) ||
      typeof body.token_type !== "string" ||
      body.token_type.toLowerCase() !== "bearer" ||
      !("expires_in" in body) ||
      typeof body.expires_in !== "number" ||
      !Number.isInteger(body.expires_in) ||
      body.expires_in <= 0 ||
      body.expires_in > 3600
    )
      throw new CloudflareAccessError("response");
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: options.now() + body.expires_in * 1000,
    };
  };
  const currentToken = async (client: CloudflareAccessClient) => {
    if (!client.grant) throw new CloudflareAccessError("sign-in-required");
    if (client.grant.expiresAt > options.now() + 60000) return client.grant.accessToken;
    const { response, body } = await jsonRequest(
      client.issuer + "/cdn-cgi/access/oauth/token",
      form({
        grant_type: "refresh_token",
        client_id: client.clientId,
        refresh_token: client.grant.refreshToken,
        resource: client.origin,
      }),
    );
    if (response.status === 400 || response.status === 401) {
      clients!.set(client.origin, withoutGrant(client));
      await save();
      throw new CloudflareAccessError("sign-in-required");
    }
    if (!response.ok) throw new CloudflareAccessError("network");
    const grant = readGrant(body);
    // Keep the rotated grant in memory before saving; a failed write must never replay its predecessor.
    clients!.set(client.origin, { ...client, grant });
    await save();
    return grant.accessToken;
  };
  const accessRefused = (response: Response, origin: string) => {
    if (response.status !== 401) return false;
    const value = /resource_metadata="([^"]+)"/u.exec(
      response.headers.get("www-authenticate") ?? "",
    )?.[1];
    if (!value) return false;
    try {
      const url = new URL(value);
      return (
        url.origin === origin &&
        (url.pathname === "/.well-known/cloudflare-access-protected-resource" ||
          url.pathname.startsWith("/.well-known/cloudflare-access-protected-resource/"))
      );
    } catch {
      return false;
    }
  };
  const clearRejected = async (origin: string, token: string) => {
    const stored = await load();
    const client = stored.get(origin);
    if (client?.grant?.accessToken === token) {
      stored.set(origin, withoutGrant(client));
      await save();
    }
  };
  const token = (url: string) =>
    exclusive(async () => {
      const origin = transportOrigin(url);
      if (origin === null) return null;
      const client = (await load()).get(origin);
      return client ? currentToken(client) : null;
    });
  return {
    token,
    peekToken: (url: string) => {
      const origin = transportOrigin(url);
      const grant = origin === null ? undefined : clients?.get(origin)?.grant;
      return grant && grant.expiresAt > options.now() ? grant.accessToken : null;
    },
    fetch: async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const request = typeof input === "object" && "url" in input ? new Request(input, init) : null;
      const url = request?.url ?? String(input);
      const credential = await token(url);
      if (credential === null) return options.fetch(input, init);
      const headers = new Headers(request?.headers ?? init.headers);
      headers.set("Cf-Access-Token", credential);
      const response = request
        ? await options.fetch(
            new Request(request, { headers, redirect: "error", credentials: "omit" }),
          )
        : await options.fetch(input, { ...init, headers, redirect: "error", credentials: "omit" });
      const origin = originOf(url);
      if (accessRefused(response, origin)) await exclusive(() => clearRejected(origin, credential));
      return response;
    },
    prepare: (url: string, redirectUri: string): Promise<CloudflareAccessTicket | null> =>
      exclusive(async () => {
        const origin = originOf(url);
        const stored = await load();
        let client = stored.get(origin);
        if (client?.grant) {
          try {
            const token = await currentToken(client);
            const { response } = await jsonRequest(origin + LOOM_IDENTITY_METADATA_PATH, {
              headers: { "Cf-Access-Token": token, accept: "application/json" },
            });
            if (!accessRefused(response, origin)) return null;
            await clearRejected(origin, token);
          } catch (error) {
            if (!(error instanceof CloudflareAccessError) || error.reason !== "sign-in-required")
              throw error;
          }
          client = stored.get(origin);
        }
        if (!client) {
          const metadata = await jsonRequest(origin + "/.well-known/oauth-protected-resource");
          const resource = metadata.body;
          if (
            !metadata.response.ok ||
            !resource ||
            typeof resource !== "object" ||
            !("authorization_servers" in resource) ||
            !Array.isArray(resource.authorization_servers) ||
            !resource.authorization_servers.some(
              (x) => typeof x === "string" && x.endsWith(".cloudflareaccess.com"),
            )
          )
            return null;
          if (
            !("resource" in resource) ||
            resource.resource !== origin ||
            resource.authorization_servers.length !== 1 ||
            !validRedirect(redirectUri)
          )
            throw new CloudflareAccessError("configuration");
          const issuer: unknown = resource.authorization_servers[0];
          if (
            typeof issuer !== "string" ||
            !/^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/u.test(issuer)
          )
            throw new CloudflareAccessError("configuration");
          const discovery = await jsonRequest(issuer + "/.well-known/oauth-authorization-server");
          const data = discovery.body;
          if (
            !discovery.response.ok ||
            !data ||
            typeof data !== "object" ||
            !("issuer" in data) ||
            data.issuer !== issuer ||
            !("authorization_endpoint" in data) ||
            data.authorization_endpoint !== issuer + "/cdn-cgi/access/oauth/authorization" ||
            !("token_endpoint" in data) ||
            data.token_endpoint !== issuer + "/cdn-cgi/access/oauth/token" ||
            !("registration_endpoint" in data) ||
            data.registration_endpoint !== issuer + "/cdn-cgi/access/oauth/registration"
          )
            throw new CloudflareAccessError("configuration");
          const registration = await jsonRequest(issuer + "/cdn-cgi/access/oauth/registration", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              client_name: "Loom",
              redirect_uris: [redirectUri],
              grant_types: ["authorization_code", "refresh_token"],
              response_types: ["code"],
              token_endpoint_auth_method: "none",
            }),
          });
          const result = registration.body;
          if (
            !registration.response.ok ||
            !result ||
            typeof result !== "object" ||
            !("client_id" in result) ||
            typeof result.client_id !== "string"
          )
            throw new CloudflareAccessError("response");
          client = { origin, issuer, clientId: result.client_id, redirectUri };
          if (!validClient(client)) throw new CloudflareAccessError("response");
          stored.set(origin, client);
          await save();
        }
        if (client.redirectUri !== redirectUri) throw new CloudflareAccessError("configuration");
        const attempt = ++nextAttempt;
        active.set(origin, attempt);
        return { registration: client, attempt };
      }),
    complete: (ticket: CloudflareAccessTicket, code: string, verifier: string): Promise<void> =>
      exclusive(async () => {
        await load();
        const client = ticket.registration;
        if (active.get(client.origin) !== ticket.attempt)
          throw new CloudflareAccessError("cancelled");
        const { response, body } = await jsonRequest(
          client.issuer + "/cdn-cgi/access/oauth/token",
          form({
            grant_type: "authorization_code",
            client_id: client.clientId,
            redirect_uri: client.redirectUri,
            code,
            code_verifier: verifier,
            resource: client.origin,
          }),
        );
        if (!response.ok) throw new CloudflareAccessError("sign-in-required");
        const grant = readGrant(body);
        if (active.get(client.origin) !== ticket.attempt) {
          await jsonRequest(
            client.issuer + "/cdn-cgi/access/oauth/revoke",
            form({
              client_id: client.clientId,
              token: grant.refreshToken,
              token_type_hint: "refresh_token",
            }),
          ).catch(() => undefined);
          throw new CloudflareAccessError("cancelled");
        }
        clients!.set(client.origin, { ...client, grant });
        await save();
        if (active.get(client.origin) !== ticket.attempt) {
          clients!.set(client.origin, withoutGrant(client));
          try {
            await save();
          } finally {
            await jsonRequest(
              client.issuer + "/cdn-cgi/access/oauth/revoke",
              form({
                client_id: client.clientId,
                token: grant.refreshToken,
                token_type_hint: "refresh_token",
              }),
            ).catch(() => undefined);
          }
          throw new CloudflareAccessError("cancelled");
        }
        active.delete(client.origin);
      }),
    cancel: (url: string) => {
      active.delete(originOf(url));
    },
    forget: (url: string): Promise<void> => {
      const origin = originOf(url);
      active.delete(origin);
      return exclusive(async () => {
        const stored = await load();
        const client = stored.get(origin);
        if (!client?.grant) return;
        stored.set(origin, withoutGrant(client));
        let storageFailed = false;
        try {
          await save();
        } catch {
          storageFailed = true;
        }
        const { response } = await jsonRequest(
          client.issuer + "/cdn-cgi/access/oauth/revoke",
          form({
            client_id: client.clientId,
            token: client.grant.refreshToken,
            token_type_hint: "refresh_token",
          }),
        );
        if (!response.ok) throw new CloudflareAccessError("network");
        if (storageFailed) throw new CloudflareAccessError("storage");
      });
    },
  };
}
