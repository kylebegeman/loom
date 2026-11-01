import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { EnvironmentId, ProviderInstanceId, ProviderDriverKind } from "../index.ts";
import { SecretProviderId, type SecretReference } from "../secretReference.ts";
import { ProviderInstanceEnvironmentVariable } from "../providerInstance.ts";
import { clientRpcRequiredScopes } from "../clientRpcPermissions.ts";
import { WS_METHODS } from "../rpc.ts";
import {
  vaultProviderReference,
  vaultProviderBinding,
  isVaultProviderReference,
  vaultProviderSettingsScopes,
} from "./vault-provider-credentials.ts";

const encodeVariable = Schema.encodeSync(ProviderInstanceEnvironmentVariable);
const decodeVariable = Schema.decodeSync(ProviderInstanceEnvironmentVariable);

const binding = {
  environmentId: EnvironmentId.make("environment:with/slashes"),
  itemId: "a".repeat(32),
  expectedVersion: 3,
};

describe("Vault provider references", () => {
  it("round-trips metadata through upstream's existing environment wire codec", () => {
    const reference = vaultProviderReference(binding);
    const variable = { name: "OPENAI_API_KEY", value: reference, sensitive: true };
    const encoded = encodeVariable(variable);
    expect(encoded).toEqual({ name: variable.name, value: "", secret: reference, sensitive: true });
    const decoded = decodeVariable(encoded);
    expect(vaultProviderBinding(decoded.value)).toEqual(binding);
    expect(isVaultProviderReference(decoded.value)).toBe(true);
    expect(vaultProviderBinding("literal")).toBeNull();
    expect(
      vaultProviderBinding({
        provider: SecretProviderId.make("onepassword"),
        reference: "op://Dev/API/key",
      }),
    ).toBeNull();
  });

  it.each([
    "invalid",
    "loom-vault:%:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:1",
    "loom-vault:env:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:0",
    "loom-vault:env:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:1e3",
  ])("refuses malformed reserved reference %s", (reference) => {
    const value: SecretReference = { provider: SecretProviderId.make("loom-vault"), reference };
    expect(isVaultProviderReference(value)).toBe(true);
    expect(vaultProviderBinding(value)).toBeNull();
  });
});

it("requires both provider and Vault authority for mutation and patch binding paths", () => {
  const instance = {
    driver: ProviderDriverKind.make("codex"),
    environment: [
      { name: "OPENAI_API_KEY", value: vaultProviderReference(binding), sensitive: true },
    ],
  };
  const input = {
    patch: {},
    providerInstanceMutation: {
      operation: "upsert" as const,
      instanceId: ProviderInstanceId.make("codex_work"),
      instance,
    },
  };
  expect(vaultProviderSettingsScopes(input)).toEqual(["providers:manage", "access:write"]);
  expect(clientRpcRequiredScopes(WS_METHODS.serverUpdateSettings, input)).toEqual([
    "providers:manage",
    "access:write",
  ]);
  expect(
    vaultProviderSettingsScopes({
      patch: { providerInstances: { [ProviderInstanceId.make("codex_work")]: instance } },
    }),
  ).toEqual(["providers:manage", "access:write"]);
  expect(
    vaultProviderSettingsScopes({
      patch: {},
      providerInstanceMutation: {
        operation: "remove",
        instanceId: ProviderInstanceId.make("codex_work"),
      },
    }),
  ).toEqual([]);
});
