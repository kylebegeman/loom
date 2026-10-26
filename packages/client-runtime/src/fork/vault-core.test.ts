import { expect, it } from "vite-plus/test";
import { VAULT_TOKEN_WARNING_SECONDS, vaultStatusMessage } from "./vault-core.ts";

const ready = { backend: "openbao", state: "ready", origin: "https://vault.example.test" } as const;
const hour = 60 * 60;

it("warns only while a ready connection's service token has under 72 hours left", () => {
  const connected = vaultStatusMessage(ready);
  expect(connected).toBe("Vault is connected. Values stay hidden until you choose to reveal them.");
  expect(vaultStatusMessage({ ...ready, tokenTtlSeconds: VAULT_TOKEN_WARNING_SECONDS })).toBe(
    connected,
  );
  expect(vaultStatusMessage({ ...ready, tokenTtlSeconds: 41.5 * hour })).toBe(
    `${connected} Its service token expires in about 41 hours. Check the token renewal job on the computer running Loom, or reissue the token before then.`,
  );
  expect(vaultStatusMessage({ ...ready, tokenTtlSeconds: hour / 2 })).toContain(
    "expires in under an hour",
  );
  expect(vaultStatusMessage({ ...ready, state: "locked", tokenTtlSeconds: hour })).toBe(
    "Your Vault backend is locked. Unlock OpenBao, then refresh.",
  );
});
