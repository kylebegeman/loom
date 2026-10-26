// @effect-diagnostics-next-line nodeBuiltinImport:off -- Effect's Crypto has no Ed25519 key generation or signing.
import * as NodeCrypto from "node:crypto";

import { describe, expect, it } from "@effect/vitest";
import { DirectoryEnvironmentReport, type LoomOsSignedIdentity } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Exit from "effect/Exit";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import {
  RELAY_HEALTH_RESPONSE_TYP,
  RelayJwtError,
  signRelayJwt,
  verifyRelayJwt,
} from "../relayJwt.ts";
import {
  DIRECTORY_REPORT_TYP,
  decodeEd25519PublicKey,
  directoryPublicKeyFromPem,
  isDirectoryRouteUrl,
  keyFingerprint,
  signDirectoryReport,
  verifyDirectoryReport,
  verifyLoomOsIdentity,
} from "./directory.ts";

const NOW = 1_792_281_600;
const DIRECTORY_URL = "https://library.example.com";

/**
 * A LoomOS signed identity with no private key kept (OpenSSL 4.0.3): `genpkey -algorithm ed25519`,
 * public_key is base64 of `pkey -pubout -outform DER`, signature is base64 of `pkeyutl -sign
 * -rawin` over `json.dumps(identity, sort_keys=True) + "\n"`. The fingerprint is SHA-256 of the DER
 * key, as `public_fingerprint` computes it.
 */
const LOOM_OS_FIXTURE: LoomOsSignedIdentity = {
  payload:
    '{"boot_id": "00000000-0000-4000-8000-000000000000", "hostname": "loom-worker", "installation_id": "fdd89fe94a7d2b2f6c8001d393810fb363bfa958f87e755d73186f3b91c4dfe7", "issued_at": "2026-10-18T12:00:00Z", "machine_key": {"algorithm": "ed25519", "fingerprint": "4f9b610da2f63797e91ca40cc68ec3405f055398c7fba8453ba5f8606113ea02", "public_key": "MCowBQYDK2VwAyEAQdoliIUulqccKilgyRKYg36Kg2GVgNmG3Tzd+jKU8Ng="}, "release": {"roles": ["worker"], "runtime_sha256": "1111111111111111111111111111111111111111111111111111111111111111", "runtime_version": "0.1.7", "schema_version": 1, "source_fingerprint": "0000000000000000000000000000000000000000000000000000000000000000", "target": "orangepi5pro", "version": "0.1.7"}, "schema_version": 1, "ssh_host_key_fingerprints": ["SHA256:w4x0WyTLW4nOnsWeMLTOBCl3KFlC8AWI+p1Rj6+Ifzo"], "tailnet_name": "worker.example.ts.net"}\n',
  signature:
    "e0QDlRdh0LU/UGN35Y+llNRK5maJ4rvNGkv8i3fLkZ7RbkoojK+d6hxdec+g9wutzPYIljoxJlN9+FHssVFoDQ==",
  public_key: "MCowBQYDK2VwAyEAQdoliIUulqccKilgyRKYg36Kg2GVgNmG3Tzd+jKU8Ng=",
};

function generateKeyPair() {
  const pair = NodeCrypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { format: "pem", type: "spki" },
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
  });
  const publicKey = directoryPublicKeyFromPem(pair.publicKey);
  if (publicKey === null) throw new Error("Expected an Ed25519 public key.");
  return { privateKeyPem: pair.privateKey, publicKeyPem: pair.publicKey, publicKey };
}

const environmentKey = generateKeyPair();

const report = Schema.decodeSync(DirectoryEnvironmentReport)({
  environmentId: "environment-a",
  label: "Studio",
  serverVersion: "0.0.0-test",
  platform: { os: "darwin", arch: "arm64" },
  supportsExecution: true,
  loomFeatures: ["core", "mini-offload"],
  routes: [{ kind: "tailnet", url: "https://computer.example.ts.net/" }],
  providers: [{ id: "codex", status: "ready" }],
  sequence: NOW * 1_000,
  reportedAt: "2026-10-18T00:00:00.000Z",
});

const sign = (input: { report?: typeof report; nowEpochSeconds?: number } = {}) =>
  signDirectoryReport({
    privateKey: environmentKey.privateKeyPem,
    report: input.report ?? report,
    audience: DIRECTORY_URL,
    nowEpochSeconds: input.nowEpochSeconds ?? NOW,
  });

const verify = (
  token: string,
  input: { publicKey?: string; audience?: string; environmentId?: string } = {},
) =>
  verifyDirectoryReport({
    publicKey: input.publicKey ?? environmentKey.publicKey,
    token,
    environmentId: input.environmentId ?? report.environmentId,
    audience: input.audience ?? DIRECTORY_URL,
    nowEpochSeconds: NOW,
  });

/** Signs arbitrary claims with the environment key, as a forger holding that key could. */
const signClaims = (typ: string, payload: Record<string, unknown>) =>
  signRelayJwt({ privateKey: environmentKey.privateKeyPem, typ, payload });

/** Everything a failure would print through the usual `Effect.logWarning(message, cause)`. */
const printedFailure = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.exit(effect).pipe(
    Effect.map((exit) => (Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "")),
  );

const PRIVATE_HOST = "private-host.example.ts.net";

const reportClaims = {
  iss: `loom-env:${report.environmentId}`,
  sub: report.environmentId,
  aud: "https://library.example.com",
  iat: NOW,
  exp: NOW + 300,
  report,
};

describe("directory reports", () => {
  it.effect("round trips a signed report", () =>
    Effect.gen(function* () {
      const token = yield* sign();
      expect(yield* verify(token)).toEqual(report);
      // Both sides sign and compare only the directory's origin.
      expect(
        yield* verify(token, { audience: `${DIRECTORY_URL}/api/loom/directory/report` }),
      ).toEqual(report);
    }),
  );

  it.effect("carries LoomOS identities unchanged", () =>
    Effect.gen(function* () {
      const withWorker = { ...report, workers: [LOOM_OS_FIXTURE] };
      const verified = yield* verify(yield* sign({ report: withWorker }));
      expect(verified.workers?.[0]).toEqual(LOOM_OS_FIXTURE);
    }),
  );

  it.effect("refuses another directory's audience", () =>
    Effect.gen(function* () {
      const error = yield* verify(yield* sign(), { audience: "https://other.example.com" }).pipe(
        Effect.flip,
      );
      expect(error.reason).toBe("unverified");
      expect(error.diagnostic).toBe("ERR_JWT_CLAIM_VALIDATION_FAILED");
    }),
  );

  it.effect("refuses the same claims under another typ", () =>
    Effect.gen(function* () {
      const token = yield* signClaims(RELAY_HEALTH_RESPONSE_TYP, reportClaims);
      const error = yield* verify(token).pipe(Effect.flip);
      expect(error.reason).toBe("unverified");
      expect(error.diagnostic).toBe("ERR_JWT_CLAIM_VALIDATION_FAILED");
    }),
  );

  it.effect("refuses an expired report", () =>
    Effect.gen(function* () {
      const error = yield* verify(yield* sign({ nowEpochSeconds: NOW - 600 })).pipe(Effect.flip);
      expect(error.reason).toBe("unverified");
      expect(error.diagnostic).toBe("ERR_JWT_EXPIRED");
    }),
  );

  it.effect("refuses a report issued too long ago, even with a distant expiry", () =>
    Effect.gen(function* () {
      const token = yield* signClaims(DIRECTORY_REPORT_TYP, {
        ...reportClaims,
        iat: NOW - 600,
        exp: NOW + 3_600,
      });
      const error = yield* verify(token).pipe(Effect.flip);
      expect(error.reason).toBe("unverified");
    }),
  );

  it.effect("keeps relay health proofs and directory reports apart", () =>
    Effect.gen(function* () {
      const healthProof = yield* signClaims(RELAY_HEALTH_RESPONSE_TYP, {
        iss: `t3-env:${report.environmentId}`,
        aud: "https://library.example.com",
        sub: report.environmentId,
        iat: NOW,
        exp: NOW + 300,
        environmentId: report.environmentId,
        status: "online",
      });
      expect((yield* verify(healthProof).pipe(Effect.flip)).reason).toBe("unverified");

      const relayError = yield* verifyRelayJwt({
        publicKey: environmentKey.publicKeyPem,
        token: yield* sign(),
        typ: RELAY_HEALTH_RESPONSE_TYP,
        issuer: `t3-env:${report.environmentId}`,
        audience: "https://library.example.com",
        nowEpochSeconds: NOW,
      }).pipe(Effect.flip);
      expect(relayError).toBeInstanceOf(RelayJwtError);
    }),
  );

  it.effect("refuses a tampered claim", () =>
    Effect.gen(function* () {
      const [header, payload, signature] = (yield* sign()).split(".");
      const claims = JSON.parse(Result.getOrThrow(Base64Url.decodeString(payload ?? "")));
      claims.report.routes = [{ kind: "public", url: "https://attacker.example.com/" }];
      const tampered = [header, Base64Url.encode(JSON.stringify(claims)), signature].join(".");

      const error = yield* verify(tampered).pipe(Effect.flip);
      expect(error.reason).toBe("unverified");
      expect(error.diagnostic).toBe("ERR_JWS_SIGNATURE_VERIFICATION_FAILED");
    }),
  );

  it.effect("refuses a report signed by another key", () =>
    Effect.gen(function* () {
      const other = generateKeyPair();
      const error = yield* verify(yield* sign(), { publicKey: other.publicKey }).pipe(Effect.flip);
      expect(error.reason).toBe("unverified");
    }),
  );

  it.effect("refuses a report for another environment", () =>
    Effect.gen(function* () {
      const token = yield* sign();
      const error = yield* verify(token, { environmentId: "environment-b" }).pipe(Effect.flip);
      expect(error.reason).toBe("wrong-environment");

      const mismatched = yield* signClaims(DIRECTORY_REPORT_TYP, {
        ...reportClaims,
        report: { ...report, environmentId: "environment-b" },
      });
      expect((yield* verify(mismatched).pipe(Effect.flip)).reason).toBe("wrong-environment");
    }),
  );

  it.effect("refuses reports that break the contract on either side", () =>
    Effect.gen(function* () {
      const route = { kind: "tailnet" as const, url: "https://computer.example.ts.net/" };
      const signError = yield* sign({
        report: { ...report, routes: Array.from({ length: 9 }, () => route) },
      }).pipe(Effect.flip);
      expect(signError.reason).toBe("invalid-report");

      const forged = yield* signClaims(DIRECTORY_REPORT_TYP, {
        ...reportClaims,
        report: { ...report, routes: undefined },
      });
      expect((yield* verify(forged).pipe(Effect.flip)).reason).toBe("invalid-report");
    }),
  );

  it.effect("keeps a refused report's claims out of the error", () =>
    Effect.gen(function* () {
      const route = { kind: "tailnet" as const, url: `https://${PRIVATE_HOST}/` };
      const withPrivateRoute = { ...report, routes: [route] };
      const overfull = yield* signClaims(DIRECTORY_REPORT_TYP, {
        ...reportClaims,
        report: { ...report, routes: Array.from({ length: 9 }, () => route) },
      });
      for (const failure of [
        verify(yield* sign({ report: withPrivateRoute }), {
          audience: "https://other.example.com",
        }),
        verify(yield* sign({ report: withPrivateRoute, nowEpochSeconds: NOW - 600 })),
        verify(overfull),
      ]) {
        const printed = yield* printedFailure(failure);
        expect(printed).toContain("DirectoryReportError");
        expect(printed).not.toContain(PRIVATE_HOST);
      }
    }),
  );

  it.effect("refuses unusable keys and audiences without echoing the token", () =>
    Effect.gen(function* () {
      const token = yield* sign();
      const badKey = yield* verify(token, { publicKey: `${environmentKey.publicKey}\n` }).pipe(
        Effect.flip,
      );
      expect(badKey.reason).toBe("invalid-key");
      expect(badKey.message).not.toContain(token);

      const badAudience = yield* signDirectoryReport({
        privateKey: environmentKey.privateKeyPem,
        report,
        audience: "not a url",
        nowEpochSeconds: NOW,
      }).pipe(Effect.flip);
      expect(badAudience.reason).toBe("invalid-audience");
    }),
  );
});

describe("isDirectoryRouteUrl", () => {
  it("keeps HTTPS routes with a DNS name", () => {
    for (const url of [
      "https://computer.example.ts.net/",
      "https://loom.example.com/",
      "https://loom.example.com",
      "https://loom.example.com:8443/loom/",
      "https://xn--bcher-kva.example.com/%7Eloom/",
    ]) {
      expect(isDirectoryRouteUrl(url), url).toBe(true);
    }
  });

  it("refuses IP literals, localhost, other schemes and anything beyond a path", () => {
    for (const url of [
      "https://127.0.0.1/",
      "https://100.64.0.1:443/",
      "https://127.1/",
      "https://0x7f.1/",
      "https://2130706433/",
      "https://[::1]/",
      "https://[fd7a:115c:a1e0::1]/",
      "https://[::ffff:127.0.0.1]/",
      "https://[::ffff:7f00:1]/",
      "https://localhost/",
      "https://localhost:3773/",
      "https://app.localhost/",
      "https://localhost.localdomain/",
      "http://computer.example.ts.net/",
      "wss://computer.example.ts.net/",
      "https://user@computer.example.ts.net/",
      "https://user:pass@computer.example.ts.net/",
      "https://@computer.example.ts.net/",
      "https://loom.example.com/?token=secret",
      "https://loom.example.com/#token",
      "https://computer/",
      "https://computer.example.ts.net./",
      "https://Loom.Example.com/",
      "HTTPS://loom.example.com/",
      "https://loom.example.com\\@attacker.example.com/",
      "https://loom.example.com/\n",
      " https://loom.example.com/",
      "https://loom.example.com:0/",
      "https://loom.example.com:65536/",
      "https://loom.example.com:/",
      "https://-loom.example.com/",
      "https://loom..example.com/",
      "https://loom.example.com/%zz",
      "https://loom.example.com/a b",
      `https://loom.example.com/${"a".repeat(2048)}`,
      "https://",
      "",
    ]) {
      expect(isDirectoryRouteUrl(url), url).toBe(false);
    }
  });
});

/** Signs a payload with a Node key, for cases OpenSSL output cannot express. */
function signIdentity(
  payload: unknown,
  key: ReturnType<typeof generateKeyPair> = generateKeyPair(),
): LoomOsSignedIdentity {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  return {
    payload: text,
    signature: NodeCrypto.sign(null, new TextEncoder().encode(text), key.privateKeyPem).toString(
      "base64",
    ),
    public_key: key.publicKey,
  };
}

function identityPayload(key: ReturnType<typeof generateKeyPair>) {
  const der = decodeEd25519PublicKey(key.publicKey);
  if (der === null) throw new Error("Expected an Ed25519 public key.");
  return {
    schema_version: 1,
    release: null,
    installation_id: null,
    boot_id: null,
    hostname: "loom-worker",
    machine_key: {
      algorithm: "ed25519",
      public_key: key.publicKey,
      fingerprint: keyFingerprint(der),
    },
    issued_at: "2026-10-18T12:00:00Z",
  };
}

const identityFailure = (identity: LoomOsSignedIdentity) =>
  verifyLoomOsIdentity(identity).pipe(
    Effect.flip,
    Effect.map((error) => error.reason),
  );

describe("verifyLoomOsIdentity", () => {
  it.effect("verifies an identity OpenSSL signed", () =>
    Effect.gen(function* () {
      const identity = yield* verifyLoomOsIdentity(LOOM_OS_FIXTURE);
      expect(identity.hostname).toBe("loom-worker");
      expect(identity.release?.version).toBe("0.1.7");
      expect(identity.tailnet_name).toBe("worker.example.ts.net");
      // Unknown keys in the signed payload are ignored, not refused.
      expect(identity.release).not.toHaveProperty("source_fingerprint");
    }),
  );

  it("fingerprints a key the way LoomOS does", () => {
    const der = decodeEd25519PublicKey(LOOM_OS_FIXTURE.public_key);
    expect(der?.length).toBe(44);
    expect(der && keyFingerprint(der)).toBe(
      "4f9b610da2f63797e91ca40cc68ec3405f055398c7fba8453ba5f8606113ea02",
    );
  });

  it.effect("refuses a changed payload byte", () =>
    Effect.gen(function* () {
      const changed = LOOM_OS_FIXTURE.payload.replace("loom-worker", "loom-workes");
      expect(yield* identityFailure({ ...LOOM_OS_FIXTURE, payload: changed })).toBe("unverified");
      const trimmed = LOOM_OS_FIXTURE.payload.trimEnd();
      expect(yield* identityFailure({ ...LOOM_OS_FIXTURE, payload: trimmed })).toBe("unverified");
    }),
  );

  it.effect("checks the bytes as received, not a re-serialization", () =>
    Effect.gen(function* () {
      const reserialized = JSON.stringify(JSON.parse(LOOM_OS_FIXTURE.payload));
      expect(yield* identityFailure({ ...LOOM_OS_FIXTURE, payload: reserialized })).toBe(
        "unverified",
      );
    }),
  );

  it.effect("refuses a swapped key", () =>
    Effect.gen(function* () {
      const other = generateKeyPair();
      expect(yield* identityFailure({ ...LOOM_OS_FIXTURE, public_key: other.publicKey })).toBe(
        "unverified",
      );
    }),
  );

  it.effect("refuses a payload that names another key than the one that signed it", () =>
    Effect.gen(function* () {
      const signer = generateKeyPair();
      const payload = identityPayload(signer);
      const otherKey = identityPayload(generateKeyPair()).machine_key;
      expect(
        yield* identityFailure(signIdentity({ ...payload, machine_key: otherKey }, signer)),
      ).toBe("key-mismatch");
      const wrongFingerprint = { ...payload.machine_key, fingerprint: otherKey.fingerprint };
      expect(
        yield* identityFailure(signIdentity({ ...payload, machine_key: wrongFingerprint }, signer)),
      ).toBe("key-mismatch");
    }),
  );

  it.effect("decodes unknown keys and refuses other schema versions or shapes", () =>
    Effect.gen(function* () {
      const signer = generateKeyPair();
      const payload = identityPayload(signer);
      const extended = yield* verifyLoomOsIdentity(
        signIdentity({ ...payload, kernel: "6.1.0-placeholder" }, signer),
      );
      expect(extended.hostname).toBe("loom-worker");

      expect(yield* identityFailure(signIdentity({ ...payload, schema_version: 2 }, signer))).toBe(
        "unsupported-version",
      );
      expect(yield* identityFailure(signIdentity({ ...payload, hostname: "" }, signer))).toBe(
        "invalid-payload",
      );
      expect(yield* identityFailure(signIdentity("not json", signer))).toBe("invalid-payload");
      expect(yield* identityFailure(signIdentity("[1]", signer))).toBe("invalid-payload");

      const tooLong = `${PRIVATE_HOST}.${"a".repeat(253)}`;
      const printed = yield* printedFailure(
        verifyLoomOsIdentity(signIdentity({ ...payload, hostname: tooLong }, signer)),
      );
      expect(printed).toContain("invalid-payload");
      expect(printed).not.toContain(PRIVATE_HOST);
    }),
  );

  it.effect("refuses malformed envelopes before verifying", () =>
    Effect.gen(function* () {
      const shortSignature = LOOM_OS_FIXTURE.signature.slice(0, 84);
      expect(yield* identityFailure({ ...LOOM_OS_FIXTURE, signature: shortSignature })).toBe(
        "malformed",
      );
      const unpadded = LOOM_OS_FIXTURE.public_key.replace(/=+$/u, "");
      expect(yield* identityFailure({ ...LOOM_OS_FIXTURE, public_key: unpadded })).toBe(
        "malformed",
      );
      const zeroKey = Base64Url.encode(new Uint8Array(44));
      expect(yield* identityFailure({ ...LOOM_OS_FIXTURE, public_key: zeroKey })).toBe("malformed");
    }),
  );
});
