// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalDate:off globalTimers:off globalTimersInEffect:off -- This native adapter owns protected storage, Chromium headers and a bounded OAuth callback.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";
import * as Electron from "electron";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import { makeCloudflareAccess } from "@t3tools/shared/fork/cloudflare-access";
import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";

const REDIRECT_URI = "http://127.0.0.1:43974/loom/access/callback";

export class DesktopAccessError extends Schema.TaggedError<DesktopAccessError>()(
  "DesktopAccessError",
  {
    operation: Schema.Literals(["storage", "sign-in", "sign-out", "transport"]),
    cause: Schema.Defect(),
  },
) {
  override get message() {
    return `Cloudflare Access ${this.operation} could not complete. Try signing in to this computer again.`;
  }
}

type Access = ReturnType<typeof makeCloudflareAccess>;
export class DesktopCloudflareAccess extends Context.Service<
  DesktopCloudflareAccess,
  {
    readonly fetch: Access["fetch"];
    readonly signIn: (
      origin: string,
      openBrowser: (url: string) => Promise<boolean>,
    ) => Effect.Effect<boolean, DesktopAccessError>;
    readonly cancel: (origin: string) => Effect.Effect<void>;
    readonly forget: (origin: string) => Effect.Effect<void, DesktopAccessError>;
    readonly install: Effect.Effect<void, DesktopAccessError, Scope.Scope>;
  }
>()("@t3tools/desktop/fork/cloudflare-access/DesktopCloudflareAccess") {}

const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const active = new Map<string, AbortController>();
  const file = NodePath.join(environment.stateDir, "loom-access-grants.json");
  const encryptionAvailable = () =>
    Electron.safeStorage.isEncryptionAvailable() &&
    (environment.platform !== "linux" ||
      Electron.safeStorage.getSelectedStorageBackend() !== "basic_text");
  const access = makeCloudflareAccess({
    now: () => Date.now(),
    fetch: (url, init) => fetch(url, init),
    storage: {
      read: async () => {
        let raw: string;
        try {
          raw = await NodeFSP.readFile(file, "utf8");
        } catch (error) {
          if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "ENOENT"
          )
            return null;
          throw error;
        }
        if (!encryptionAvailable()) throw new Error("Protected storage unavailable");
        return Electron.safeStorage.decryptString(Buffer.from(raw, "base64"));
      },
      write: async (value) => {
        if (!encryptionAvailable()) throw new Error("Protected storage unavailable");
        await NodeFSP.mkdir(environment.stateDir, { recursive: true, mode: 0o700 });
        const temp = file + "." + NodeCrypto.randomUUID();
        try {
          await NodeFSP.writeFile(
            temp,
            Electron.safeStorage.encryptString(value).toString("base64"),
            { mode: 0o600, flag: "wx" },
          );
          await NodeFSP.rename(temp, file);
        } finally {
          await NodeFSP.rm(temp, { force: true });
        }
      },
    },
  });
  const signIn = Effect.fn("DesktopCloudflareAccess.signIn")(function (
    value: string,
    openBrowser: (url: string) => Promise<boolean>,
  ) {
    return Effect.tryPromise({
      try: async (signal) => {
        const origin = new URL(value).origin;
        if (active.has(origin)) throw new Error("Access sign-in is already open");
        const abort = new AbortController();
        active.set(origin, abort);
        const interrupted = () => abort.abort();
        signal.addEventListener("abort", interrupted, { once: true });
        const timer = setTimeout(interrupted, 300000);
        let server: NodeHttp.Server | undefined;
        try {
          if (signal.aborted) throw new Error("Sign-in cancelled");
          const ticket = await access.prepare(origin, REDIRECT_URI);
          if (abort.signal.aborted) throw new Error("Sign-in cancelled");
          if (!ticket) return false;
          const state = NodeCrypto.randomBytes(32).toString("base64url");
          const verifier = NodeCrypto.randomBytes(32).toString("base64url");
          const callback = Promise.withResolvers<string>();
          // The rejection is observed even if browser launch fails before awaiting the callback.
          void callback.promise.catch(() => undefined);
          const onAbort = () => callback.reject(new Error("Sign-in cancelled"));
          abort.signal.addEventListener("abort", onAbort, { once: true });
          server = NodeHttp.createServer((request, response) => {
            const url = new URL(request.url ?? "/", REDIRECT_URI);
            if (
              request.method !== "GET" ||
              request.headers.host !== "127.0.0.1:43974" ||
              url.pathname !== "/loom/access/callback"
            ) {
              response.writeHead(404).end();
              return;
            }
            if (
              url.searchParams.getAll("state").length !== 1 ||
              url.searchParams.get("state") !== state ||
              (url.searchParams.has("iss") &&
                url.searchParams.get("iss") !== ticket.registration.issuer)
            ) {
              response.writeHead(400).end("This response does not belong to this sign-in.");
              return;
            }
            const code = url.searchParams.get("code");
            response.writeHead(200, {
              "content-type": "text/plain; charset=utf-8",
              "cache-control": "no-store",
              "referrer-policy": "no-referrer",
            });
            if (
              url.searchParams.has("error") ||
              url.searchParams.getAll("code").length !== 1 ||
              !code ||
              code.length > 4096
            ) {
              response.end("Access sign-in did not complete. Return to Loom.");
              callback.reject(new Error("Access authorization refused"));
              return;
            }
            response.end("Access authorization received. Return to Loom to finish connecting.");
            callback.resolve(code);
          });
          await new Promise<void>((resolve, reject) => {
            server!.once("error", reject);
            server!.listen(43974, "127.0.0.1", resolve);
          });
          const url = new URL(ticket.registration.issuer + "/cdn-cgi/access/oauth/authorization");
          for (const [key, parameter] of Object.entries({
            client_id: ticket.registration.clientId,
            redirect_uri: REDIRECT_URI,
            response_type: "code",
            resource: origin,
            state,
            code_challenge_method: "S256",
            code_challenge: NodeCrypto.createHash("sha256").update(verifier).digest("base64url"),
          }))
            url.searchParams.set(key, parameter);
          if (!(await openBrowser(url.href))) throw new Error("Could not open the system browser");
          const code = await callback.promise;
          if (abort.signal.aborted) throw new Error("Sign-in cancelled");
          await access.complete(ticket, code, verifier);
          abort.signal.removeEventListener("abort", onAbort);
          return true;
        } finally {
          access.cancel(origin);
          active.delete(origin);
          signal.removeEventListener("abort", interrupted);
          clearTimeout(timer);
          const listener = server;
          if (listener) {
            listener.closeAllConnections();
            await new Promise<void>((resolve) => listener.close(() => resolve()));
          }
        }
      },
      catch: (cause) => new DesktopAccessError({ operation: "sign-in", cause }),
    });
  });
  const install = Effect.acquireRelease(
    Effect.try({
      try: () => {
        Electron.session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
          const headers = { ...details.requestHeaders };
          for (const key of Object.keys(headers))
            if (key.toLowerCase() === "cf-access-token") delete headers[key];
          const protocol = new URL(details.url).protocol;
          if (protocol !== "https:" && protocol !== "wss:") {
            callback({ requestHeaders: headers });
            return;
          }
          void access.token(details.url).then(
            (token) => {
              if (token) headers["Cf-Access-Token"] = token;
              callback({ requestHeaders: headers });
            },
            () => callback({ cancel: true }),
          );
        });
      },
      catch: (cause) => new DesktopAccessError({ operation: "transport", cause }),
    }),
    () => Effect.sync(() => Electron.session.defaultSession.webRequest.onBeforeSendHeaders(null)),
  );
  return DesktopCloudflareAccess.of({
    fetch: access.fetch,
    signIn,
    cancel: Effect.fn("DesktopCloudflareAccess.cancel")((value) =>
      Effect.try(() => new URL(value).origin).pipe(
        Effect.match({
          onFailure: () => undefined,
          onSuccess: (origin) => {
            active.get(origin)?.abort();
            access.cancel(origin);
          },
        }),
      ),
    ),
    forget: Effect.fn("DesktopCloudflareAccess.forget")((value) =>
      Effect.tryPromise({
        try: () => access.forget(value),
        catch: (cause) => new DesktopAccessError({ operation: "sign-out", cause }),
      }),
    ),
    install,
  });
});
export const layer = Layer.effect(DesktopCloudflareAccess, make);
