// @effect-diagnostics nodeBuiltinImport:off - one small read; Effect FileSystem would add seams to the upstream probe.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type { ServerProvider } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as HostProcess from "@t3tools/shared/HostProcess";

import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";

/**
 * Codex reports no account when `model_provider` points at a custom provider,
 * such as a CLIProxyAPI hub, even though the home is still signed in to
 * ChatGPT and still reports that login's rate limits. Without an email those
 * limits cannot be matched to the hub's report of the same subscription, so the
 * usage views count the account twice. This reads the email from the home's
 * own login instead.
 *
 * Only instances with an explicit home (every per-account instance has one) are
 * read. Without one, the probe's CODEX_HOME comes from the instance environment,
 * which is not visible here, and guessing could credit the wrong account.
 */
/** The email claim of a ChatGPT login's ID token in a Codex `auth.json`. */
export function emailFromCodexAuth(text: string): string | undefined {
  try {
    const auth: unknown = JSON.parse(text);
    if (typeof auth !== "object" || auth === null || !("tokens" in auth)) return undefined;
    const tokens = auth.tokens;
    if (typeof tokens !== "object" || tokens === null || !("id_token" in tokens)) return undefined;
    const idToken = tokens.id_token;
    const payload = typeof idToken === "string" ? idToken.split(".")[1] : undefined;
    if (!payload) return undefined;
    const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof claims !== "object" || claims === null || !("email" in claims)) return undefined;
    const email = claims.email;
    return typeof email === "string" && email.includes("@") ? email.trim() : undefined;
  } catch {
    return undefined;
  }
}

interface AccountStatus {
  readonly status: string;
  readonly auth: ServerProvider["auth"];
}

/** Adds the login's email when Codex reported no account and nothing else named one. */
export const withCodexLoginEmail = <S extends AccountStatus>(
  status: S,
  snapshot: { readonly account: { readonly account?: unknown } },
  settings: { readonly homePath: string },
): Effect.Effect<S> => {
  const home = settings.homePath.trim();
  if (!home || snapshot.account.account != null || status.status !== "ready" || status.auth.email) {
    return Effect.succeed(status);
  }
  return HostProcess.HomeDirectory.pipe(
    Effect.flatMap((userHome) =>
      Effect.tryPromise(() =>
        NodeFSP.readFile(NodePath.join(expandHomePath(home, userHome), "auth.json"), "utf8"),
      ),
    ),
    Effect.map((text) => {
      const email = emailFromCodexAuth(text);
      return email ? { ...status, auth: { ...status.auth, email } } : status;
    }),
    Effect.orElseSucceed(() => status),
  );
};
