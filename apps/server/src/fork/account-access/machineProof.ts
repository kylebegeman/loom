import type { EnvironmentId } from "@t3tools/contracts";
import { signRelayJwt } from "@t3tools/shared/relayJwt";
import * as Clock from "effect/Clock";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Signature from "effect/crypto/Signature";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import { getOrCreateEnvironmentKeyPairFromSecretStore } from "../../cloud/environmentKeys.ts";

const PROOF_SECONDS = 30;

/** The Library connection a proof is bound to: `LibraryConnection`'s remote credential. */
export interface MachineProofCredential {
  readonly sourceEnvironmentId: EnvironmentId;
  readonly libraryEnvironmentId: EnvironmentId;
  readonly sessionId: string;
  readonly account: { readonly authorityId: string; readonly authorityEpoch: number };
}

/**
 * Signs `payload` as this computer, for `AccountWorkloads.acceptProvider` on the Library. The proof
 * names no workload, so it vouches for the computer alone and lives for thirty seconds.
 */
export const signMachineProof = Effect.fn("AccountMachineProof.sign")(function* (
  payload: string,
  credential: MachineProofCredential,
) {
  const signature = yield* Signature.Signature;
  const keys = yield* getOrCreateEnvironmentKeyPairFromSecretStore(yield* ServerSecretStore).pipe(
    Effect.provideService(Signature.Signature, signature),
  );
  const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
  const digest = yield* (yield* Digest.Digest).digest(
    Digest.sha256,
    new TextEncoder().encode(payload),
  );
  return yield* signRelayJwt({
    privateKey: keys.privateKey,
    typ: "loom-account-workload+jwt",
    payload: {
      iss: credential.sourceEnvironmentId,
      sub: credential.sourceEnvironmentId,
      aud: credential.libraryEnvironmentId,
      publisherSessionId: credential.sessionId,
      authorityId: credential.account.authorityId,
      authorityEpoch: credential.account.authorityEpoch,
      nonce: Hex.encode(yield* (yield* SecureRandom.SecureRandom).randomBytes(16)),
      digest: Hex.encode(digest),
      iat: now,
      exp: now + PROOF_SECONDS,
    },
  }).pipe(Effect.provideService(Signature.Signature, signature));
});
