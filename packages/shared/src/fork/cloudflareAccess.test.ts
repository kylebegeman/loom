import { describe, expect, it } from "@effect/vitest";
import { makeCloudflareAccess, type CloudflareAccessClient } from "./cloudflareAccess.ts";

const ORIGIN = "https://computer.example.test";
const ISSUER = "https://owner.cloudflareaccess.com";
const NOW = 1_800_000_000_000;
const client: CloudflareAccessClient = {
  origin: ORIGIN,
  issuer: ISSUER,
  clientId: "native-client",
  redirectUri: "loom-dev://access-auth",
  grant: { accessToken: "opaque-access", refreshToken: "refresh-before", expiresAt: NOW + 900_000 },
};

function setup(initial: readonly CloudflareAccessClient[] = [client]) {
  let raw: string | null = JSON.stringify({ version: 1, clients: initial });
  const requests: {
    url: string;
    headers: Headers;
    body: URLSearchParams;
    redirect: RequestRedirect | undefined;
  }[] = [];
  const responses: (Response | Promise<Response>)[] = [];
  const started = Promise.withResolvers<void>();
  let failedWrites = 0;
  let writePause:
    | {
        started: ReturnType<typeof Promise.withResolvers<void>>;
        release: ReturnType<typeof Promise.withResolvers<void>>;
      }
    | undefined;
  const transport = makeCloudflareAccess({
    storage: {
      read: async () => raw,
      write: async (value) => {
        const pause = writePause;
        writePause = undefined;
        if (pause) {
          pause.started.resolve();
          await pause.release.promise;
        }
        if (failedWrites > 0) {
          failedWrites--;
          throw new Error("Keychain locked");
        }
        raw = value;
      },
    },
    now: () => NOW,
    fetch: async (url, init) => {
      requests.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body: new URLSearchParams(String(init?.body ?? "")),
        redirect: init?.redirect,
      });
      started.resolve();
      return responses.shift() ?? new Response("{}", { status: 200 });
    },
  });
  return {
    transport,
    started: started.promise,
    requests,
    responses,
    blockNextWrite: () => {
      const pause = {
        started: Promise.withResolvers<void>(),
        release: Promise.withResolvers<void>(),
      };
      writePause = pause;
      return { started: pause.started.promise, release: () => pause.release.resolve() };
    },
    failNextWrite: () => {
      failedWrites++;
    },
    stored: () => JSON.parse(raw ?? "null"),
  };
}

describe("Cloudflare Access native transport", () => {
  it("keeps Loom authorization alongside the revocable Access token and refuses redirect forwarding", async () => {
    const { transport, requests } = setup();
    await transport.fetch(ORIGIN + "/api/config", {
      headers: { authorization: "Bearer loom-session" },
      redirect: "follow",
    });
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer loom-session");
    expect(requests[0]?.headers.get("cf-access-token")).toBe("opaque-access");
    expect(requests[0]?.redirect).toBe("error");
    expect(await transport.token("wss://computer.example.test/ws")).toBe("opaque-access");
    await transport.fetch("https://other.example.test/api", {});
    expect(requests[1]?.headers.has("cf-access-token")).toBe(false);
  });

  it("renews one expired grant once for concurrent requests and persists rotation before use", async () => {
    const { transport, requests, responses, stored } = setup([
      { ...client, grant: { ...client.grant!, expiresAt: NOW } },
    ]);
    responses.push(
      Response.json({
        token_type: "bearer",
        access_token: "new-opaque",
        refresh_token: "refresh-after",
        expires_in: 900,
      }),
    );
    expect(await Promise.all([transport.token(ORIGIN), transport.token(ORIGIN)])).toEqual([
      "new-opaque",
      "new-opaque",
    ]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.body.get("refresh_token")).toBe("refresh-before");
    expect(stored().clients[0].grant.refreshToken).toBe("refresh-after");
  });

  it("removes a rejected grant, retains its registered client and requires sign-in", async () => {
    const { transport, responses, stored } = setup([
      { ...client, grant: { ...client.grant!, expiresAt: NOW } },
    ]);
    responses.push(Response.json({ error: "invalid_grant" }, { status: 400 }));
    await expect(transport.token(ORIGIN)).rejects.toMatchObject({ reason: "sign-in-required" });
    expect(stored().clients[0].clientId).toBe(client.clientId);
    expect(stored().clients[0].grant).toBeUndefined();
  });

  it("keeps a grant during network failure", async () => {
    const { transport, responses, stored } = setup([
      { ...client, grant: { ...client.grant!, expiresAt: NOW } },
    ]);
    responses.push(new Response(null, { status: 503 }));
    await expect(transport.token(ORIGIN)).rejects.toMatchObject({ reason: "network" });
    expect(stored().clients[0].grant.refreshToken).toBe("refresh-before");
  });

  it("persists a rotation before sending its token and does not replay its predecessor after a failed save", async () => {
    const { transport, requests, responses, stored, failNextWrite } = setup([
      { ...client, grant: { ...client.grant!, expiresAt: NOW } },
    ]);
    responses.push(
      Response.json({
        token_type: "bearer",
        access_token: "rotated-access",
        refresh_token: "rotated-refresh",
        expires_in: 900,
      }),
    );
    failNextWrite();
    await expect(transport.token(ORIGIN)).rejects.toMatchObject({ reason: "storage" });
    expect(await transport.token(ORIGIN)).toBe("rotated-access");
    expect(requests).toHaveLength(1);
    expect(stored().clients[0].grant.refreshToken).toBe("rotated-refresh");
  });

  it("forgets locally before revoking only this client's grant", async () => {
    const { transport, requests, stored } = setup();
    await transport.forget(ORIGIN);
    expect(stored().clients[0].grant).toBeUndefined();
    expect(requests[0]?.url).toBe(ISSUER + "/cdn-cgi/access/oauth/revoke");
    expect(requests[0]?.body.get("token")).toBe("refresh-before");
    await expect(transport.token(ORIGIN)).rejects.toMatchObject({ reason: "sign-in-required" });
  });

  it("rejects saved issuer and resource substitutions before sending credentials", async () => {
    const { transport, requests } = setup([
      { ...client, issuer: "https://owner.cloudflareaccess.com.attacker.test" },
    ]);
    await expect(transport.token(ORIGIN)).rejects.toMatchObject({ reason: "storage" });
    expect(requests).toEqual([]);
  });
});

it("clears an explicitly revoked Access token without replaying the failed operation", async () => {
  const { transport, responses, requests, stored } = setup();
  responses.push(
    new Response(null, {
      status: 401,
      headers: {
        "www-authenticate":
          'Bearer resource_metadata="' +
          ORIGIN +
          '/.well-known/cloudflare-access-protected-resource/api"',
      },
    }),
  );
  const response = await transport.fetch(ORIGIN + "/api", {
    method: "POST",
    body: "one-operation",
  });
  expect(response.status).toBe(401);
  expect(requests).toHaveLength(1);
  expect(stored().clients[0].grant).toBeUndefined();
  expect(await transport.prepare(ORIGIN, client.redirectUri)).toMatchObject({
    registration: { clientId: client.clientId },
  });
});

it("allows a fresh interactive sign-in when a cached token was revoked before expiry", async () => {
  const { transport, responses, requests } = setup();
  responses.push(
    new Response(null, {
      status: 401,
      headers: {
        "www-authenticate":
          'Bearer resource_metadata="' +
          ORIGIN +
          '/.well-known/cloudflare-access-protected-resource/"',
      },
    }),
  );
  expect(await transport.prepare(ORIGIN, client.redirectUri)).toMatchObject({
    registration: { clientId: client.clientId },
  });
  expect(requests).toHaveLength(1);
});

it("cancels an in-flight code exchange without restoring its grant", async () => {
  const { grant: _grant, ...registration } = client;
  const { transport, responses, started, requests, stored } = setup([registration]);
  const ticket = await transport.prepare(ORIGIN, client.redirectUri);
  if (!ticket) throw new Error("Expected sign-in ticket");
  const exchange = Promise.withResolvers<Response>();
  responses.push(exchange.promise);
  const completing = transport.complete(ticket, "code", "verifier");
  await started;
  transport.cancel(ORIGIN);
  exchange.resolve(
    Response.json({
      token_type: "bearer",
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 900,
    }),
  );
  await expect(completing).rejects.toMatchObject({ reason: "cancelled" });
  expect(stored().clients[0].grant).toBeUndefined();
  expect(requests.at(-1)?.url).toBe(ISSUER + "/cdn-cgi/access/oauth/revoke");
});

it("does not keep a grant when sign-in is cancelled while protected storage is committing", async () => {
  const { grant: _grant, ...registration } = client;
  const { transport, responses, stored, blockNextWrite } = setup([registration]);
  const ticket = await transport.prepare(ORIGIN, client.redirectUri);
  if (!ticket) throw new Error("Expected sign-in ticket");
  responses.push(
    Response.json({
      token_type: "bearer",
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 900,
    }),
  );
  const blocked = blockNextWrite();
  const completing = transport.complete(ticket, "code", "verifier");
  await blocked.started;
  transport.cancel(ORIGIN);
  blocked.release();
  await expect(completing).rejects.toMatchObject({ reason: "cancelled" });
  expect(stored().clients[0].grant).toBeUndefined();
});

it("revokes a forgotten grant even when protected local storage cannot commit its removal", async () => {
  const { transport, failNextWrite, requests } = setup();
  failNextWrite();
  await expect(transport.forget(ORIGIN)).rejects.toMatchObject({ reason: "storage" });
  expect(requests[0]?.url).toBe(ISSUER + "/cdn-cgi/access/oauth/revoke");
  expect(transport.peekToken(ORIGIN)).toBeNull();
  await expect(transport.token(ORIGIN)).rejects.toMatchObject({ reason: "sign-in-required" });
});
