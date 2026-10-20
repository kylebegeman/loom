import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  type LoomOsSignedIdentity,
  MiniOffloadError,
  type MiniWorker,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Config from "../../config.ts";
import * as Projects from "../../orchestration-v2/ProjectStore.ts";
import * as Threads from "../../orchestration-v2/ProjectionStore.ts";
import * as ProcessRunner from "../../processRunner.ts";
import * as Mini from "./MiniOffloadService.ts";
import * as Ssh from "./MiniSshTransport.ts";

const worker: MiniWorker = {
  id: "pi-01",
  name: "Test Pi",
  target: "pi-test",
  sshConfig: null,
  enabled: true,
};

/** Signed the LoomOS way with OpenSSL; copied from the shared directory tests. */
const IDENTITY: LoomOsSignedIdentity = {
  payload:
    '{"boot_id": "00000000-0000-4000-8000-000000000000", "hostname": "loom-worker", "installation_id": "fdd89fe94a7d2b2f6c8001d393810fb363bfa958f87e755d73186f3b91c4dfe7", "issued_at": "2026-10-18T12:00:00Z", "machine_key": {"algorithm": "ed25519", "fingerprint": "4f9b610da2f63797e91ca40cc68ec3405f055398c7fba8453ba5f8606113ea02", "public_key": "MCowBQYDK2VwAyEAQdoliIUulqccKilgyRKYg36Kg2GVgNmG3Tzd+jKU8Ng="}, "release": {"roles": ["worker"], "runtime_sha256": "1111111111111111111111111111111111111111111111111111111111111111", "runtime_version": "0.1.7", "schema_version": 1, "source_fingerprint": "0000000000000000000000000000000000000000000000000000000000000000", "target": "orangepi5pro", "version": "0.1.7"}, "schema_version": 1, "ssh_host_key_fingerprints": ["SHA256:w4x0WyTLW4nOnsWeMLTOBCl3KFlC8AWI+p1Rj6+Ifzo"], "tailnet_name": "worker.example.ts.net"}\n',
  signature:
    "e0QDlRdh0LU/UGN35Y+llNRK5maJ4rvNGkv8i3fLkZ7RbkoojK+d6hxdec+g9wutzPYIljoxJlN9+FHssVFoDQ==",
  public_key: "MCowBQYDK2VwAyEAQdoliIUulqccKilgyRKYg36Kg2GVgNmG3Tzd+jKU8Ng=",
};

/** What LoomOS 0.1.6 answers: everything readiness needs and no identity. */
const CAPABILITIES = {
  architecture: "aarch64",
  cpu_count: 8,
  toolsets: [{ id: "repository", missing: [] }],
  loom: { service_active: true },
  command_jobs: {
    may_start: true,
    worker_active: true,
    storage_available: true,
    slots: 2,
    active: 0,
    waiting_reasons: [],
  },
};

const unexpected = <A extends object>(): A =>
  new Proxy({} as A, {
    get: (_, key) => {
      throw new Error(`Unexpected test service call: ${String(key)}`);
    },
  });

const setup = Effect.gen(function* () {
  let answer: object | null = CAPABILITIES;
  let calls = 0;
  const transport: Ssh.MiniSshTransport["Service"] = {
    request: () =>
      Effect.suspend(() => {
        calls += 1;
        return answer === null
          ? Effect.fail(new MiniOffloadError({ reason: "transfer" }))
          : Effect.succeed(answer);
      }),
  };
  // Built in the test's scope, so the temporary state directory outlives the service.
  const context = yield* Layer.build(
    Mini.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Config.layerTest(process.cwd(), { prefix: "mini-identity-test-" }),
          ProcessRunner.layer,
          Layer.succeed(Ssh.MiniSshTransport, transport),
          Layer.succeed(Threads.ProjectionStoreV2, unexpected()),
          Layer.succeed(Projects.ProjectStoreV2, unexpected()),
        ).pipe(Layer.provideMerge(NodeServices.layer)),
      ),
    ),
  );
  const service = Context.get(context, Mini.MiniOffloadService);
  yield* service.register(worker);
  return {
    service,
    calls: () => calls,
    /** The next capabilities answer, or `null` for an unreachable worker. */
    answer: (value: object | null) => {
      answer = value;
    },
  };
});

describe("Mini worker identities", () => {
  it.effect("a worker without an identity still checks as ready and reports none", () =>
    Effect.gen(function* () {
      const f = yield* setup;
      expect((yield* f.service.check({ workerId: worker.id })).status).toBe("ready");
      expect(yield* f.service.identities).toEqual([]);
    }).pipe(Effect.scoped),
  );

  it.effect("keeps the last identity each enabled worker answered with, without SSH calls", () =>
    Effect.gen(function* () {
      const f = yield* setup;
      f.answer({ ...CAPABILITIES, identity: IDENTITY });
      expect((yield* f.service.check({ workerId: worker.id })).status).toBe("ready");
      expect(yield* f.service.identities).toEqual([IDENTITY]);
      expect(f.calls()).toBe(1);

      // A failed check is no answer, so the last identity stays.
      f.answer(null);
      expect((yield* f.service.check({ workerId: worker.id })).status).toBe("unreachable");
      expect(yield* f.service.identities).toEqual([IDENTITY]);

      yield* f.service.setEnabled({ workerId: worker.id, enabled: false });
      expect(yield* f.service.identities).toEqual([]);
      yield* f.service.setEnabled({ workerId: worker.id, enabled: true });
      expect(yield* f.service.identities).toEqual([IDENTITY]);
      expect(f.calls()).toBe(2);

      // A malformed identity never fails readiness, and the answer drops the old one.
      f.answer({ ...CAPABILITIES, identity: { ...IDENTITY, payload: "" } });
      expect((yield* f.service.check({ workerId: worker.id })).status).toBe("ready");
      expect(yield* f.service.identities).toEqual([]);
    }).pipe(Effect.scoped),
  );
});
