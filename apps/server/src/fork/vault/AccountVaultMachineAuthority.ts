import {
  AccountProviderRequest,
  AccountProfileRecordRequest,
  type AccountProfileRecordResponse,
  VaultError,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import type { AuthenticatedSession } from "../../auth/EnvironmentAuth.ts";
import * as AccountWorkloads from "../account-access/AccountWorkloads.ts";
import * as VaultProfileRecords from "./VaultProfileRecords.ts";
import * as VaultProfiles from "./VaultProfiles.ts";
import * as VaultProviderCredentials from "./VaultProviderCredentials.ts";

const decodeProfile = Schema.decodeUnknownEffect(
  Schema.fromJsonString(AccountProfileRecordRequest),
);
const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(AccountProviderRequest));
export class AccountVaultMachineAuthority extends Context.Service<
  AccountVaultMachineAuthority,
  {
    readonly profileRecord: (
      envelope: { readonly payload: string; readonly proof: string },
      publisher: AuthenticatedSession | undefined,
    ) => Effect.Effect<AccountProfileRecordResponse, VaultError>;
    readonly providerCredential: (
      envelope: { readonly payload: string; readonly proof: string },
      publisher: AuthenticatedSession | undefined,
    ) => Effect.Effect<{ readonly value: Redacted.Redacted<string> | null }, VaultError>;
  }
>()("t3/fork/vault/AccountVaultMachineAuthority") {}

const make = Effect.gen(function* () {
  const workloads = yield* AccountWorkloads.AccountWorkloads;
  const records = yield* VaultProfileRecords.VaultProfileRecords;
  const profiles = yield* VaultProfiles.VaultProfiles;
  const credentials = yield* VaultProviderCredentials.VaultProviderCredentials;
  return AccountVaultMachineAuthority.of({
    profileRecord: Effect.fn("AccountVaultMachineAuthority.profileRecord")(
      function* (envelope, publisher) {
        const lease = yield* workloads.acceptProvider(envelope.payload, envelope.proof, publisher);
        const input = yield* decodeProfile(envelope.payload).pipe(
          Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
        );
        if (input.kind === "preview") {
          const authorize = records
            .forAccount(
              { kind: "read", projectId: input.projectId, key: "registry" },
              lease.sourceEnvironmentId,
              lease.ownerSubject,
              workloads.revalidate(lease),
            )
            .pipe(Effect.asVoid);
          const preview = yield* profiles.previewForAccount(input.profile, authorize).pipe(
            Effect.catchTags({
              VaultSshError: () => Effect.fail(new VaultError({ reason: "unavailable" })),
              VaultWorkloadError: () => Effect.fail(new VaultError({ reason: "unavailable" })),
            }),
          );
          return { kind: "preview", preview };
        }
        return yield* records.forAccount(
          input,
          lease.sourceEnvironmentId,
          lease.ownerSubject,
          workloads.revalidate(lease),
        );
      },
    ),
    providerCredential: Effect.fn("AccountProviderAuthority.execute")(
      function* (envelope, publisher) {
        const lease = yield* workloads.acceptProvider(envelope.payload, envelope.proof, publisher);
        const input = yield* decode(envelope.payload).pipe(
          Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
        );
        return yield* credentials.forAccount(
          input,
          lease.ownerSubject,
          workloads.revalidate(lease),
        );
      },
    ),
  });
});
export const layer = Layer.effect(AccountVaultMachineAuthority, make);
