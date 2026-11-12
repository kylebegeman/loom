import { AccountProviderRequest, VaultError } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import type { AuthenticatedSession } from "../../auth/EnvironmentAuth.ts";
import * as AccountWorkloads from "../account-access/AccountWorkloads.ts";
import * as VaultProviderCredentials from "./VaultProviderCredentials.ts";

const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(AccountProviderRequest));
export class AccountProviderAuthority extends Context.Service<
  AccountProviderAuthority,
  {
    readonly execute: (
      envelope: { readonly payload: string; readonly proof: string },
      publisher: AuthenticatedSession,
    ) => Effect.Effect<{ readonly value: Redacted.Redacted<string> | null }, VaultError>;
  }
>()("t3/fork/vault/AccountProviderAuthority") {}

const make = Effect.gen(function* () {
  const workloads = yield* AccountWorkloads.AccountWorkloads;
  const credentials = yield* VaultProviderCredentials.VaultProviderCredentials;
  return AccountProviderAuthority.of({
    execute: Effect.fn("AccountProviderAuthority.execute")(function* (envelope, publisher) {
      const lease = yield* workloads.acceptProvider(envelope.payload, envelope.proof, publisher);
      const input = yield* decode(envelope.payload).pipe(
        Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
      );
      return yield* credentials.forAccount(input, lease.ownerSubject, workloads.revalidate(lease));
    }),
  });
});
export const layer = Layer.effect(AccountProviderAuthority, make);
