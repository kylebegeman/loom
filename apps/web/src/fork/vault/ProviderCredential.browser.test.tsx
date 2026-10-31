import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { EnvironmentId, type SecretReference } from "@t3tools/contracts";
import { vaultProviderReference, type VaultReference } from "@t3tools/contracts/fork";
import { AsyncResult, Atom } from "effect/reactivity";
import { render } from "../../../test/render";
import { VaultProviderCredential } from "./ProviderCredential";

const state = vi.hoisted(() => ({
  supported: true,
  manage: true,
  write: null as unknown as Atom.Atom<boolean>,
  metadata: null as unknown as Atom.Atom<AsyncResult.AsyncResult<VaultReference | null>>,
  selected: null as unknown as VaultReference,
}));

vi.mock(import("@t3tools/client-runtime/fork"), async (original) => ({
  ...(await original()),
  createVaultReferenceAtoms: (() => ({ describe: () => state.metadata })) as never,
  supportsLoomFeature: (_capabilities: unknown, feature: string) =>
    feature === "vault-provider-credentials" && state.supported,
}));
vi.mock(import("~/state/entities"), () => ({ useServerConfigs: () => new Map() }));
vi.mock(import("~/state/session"), () => ({
  useEnvironmentScope: (_environmentId: unknown, scope: string) =>
    scope === "providers:manage" ? state.manage : true,
}));
vi.mock(import("./state"), () => ({
  vault: { save: { permissionAtom: () => state.write } } as never,
}));
vi.mock(import("./ReferencePicker"), () => ({
  VaultReferencePicker: ({
    disabled,
    onSelect,
  }: {
    disabled?: boolean;
    onSelect?: (reference: VaultReference) => void;
  }) => (
    <button disabled={disabled} onClick={() => onSelect?.(state.selected)}>
      Select development API key
    </button>
  ),
}));

const environmentId = EnvironmentId.make("credential-computer");

function setup() {
  state.supported = true;
  state.manage = true;
  state.write = Atom.make(true);
  state.selected = {
    environmentId,
    reference: "metadata-only",
    item: {
      id: "a".repeat(32),
      label: "Development API key",
      kind: "secret",
      state: "active",
      version: 2,
      createdAt: "2026-10-31T00:00:00Z",
      updatedAt: "2026-10-31T00:00:00Z",
    },
  };
  state.metadata = Atom.make(AsyncResult.success(state.selected));
}

function CredentialEditor({
  initialValue = "old-synthetic-key",
}: {
  initialValue?: string | SecretReference;
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <VaultProviderCredential
      environmentId={environmentId}
      providerName="Development provider"
      variableName="OPENAI_API_KEY"
      value={value}
      onChange={(reference) => setValue(reference ?? "")}
    >
      <input
        aria-label="Provider API key"
        value={typeof value === "string" ? value : ""}
        onChange={(event) => setValue(event.target.value)}
      />
    </VaultProviderCredential>
  );
}

describe("Vault provider credential selection", () => {
  it("replaces a literal with a pinned Vault source and clears it without restoring the old value", async () => {
    setup();
    await using screen = await render(<CredentialEditor />);
    await expect
      .element(screen.getByRole("textbox", { name: "Provider API key" }))
      .toHaveValue("old-synthetic-key");

    await userEvent.click(screen.getByRole("button", { name: "Use Vault" }));
    await userEvent.click(screen.getByRole("button", { name: "Select development API key" }));
    await expect.element(screen.getByText("Development API key · Version 2")).toBeVisible();
    await expect
      .element(screen.getByRole("textbox", { name: "Provider API key" }))
      .not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Remove Vault item" }));
    await expect.element(screen.getByRole("textbox", { name: "Provider API key" })).toHaveValue("");
  });

  it("keeps a saved Vault source out of the literal editor on an older server", async () => {
    setup();
    state.supported = false;
    const initialValue = vaultProviderReference({
      environmentId,
      itemId: state.selected.item.id,
      expectedVersion: state.selected.item.version,
    });
    await using screen = await render(<CredentialEditor initialValue={initialValue} />);
    await expect
      .element(screen.getByText("Update Loom on this computer to use Vault provider credentials."))
      .toBeVisible();
    await expect
      .element(screen.getByRole("textbox", { name: "Provider API key" }))
      .not.toBeInTheDocument();
    await expect.element(screen.getByRole("button", { name: "Change Vault item" })).toBeDisabled();
  });

  it("requires Vault write access before offering an application binding", async () => {
    setup();
    state.write = Atom.make(false);
    await using screen = await render(<CredentialEditor />);
    await expect.element(screen.getByRole("button", { name: "Use Vault" })).toBeDisabled();
    await expect
      .element(screen.getByRole("textbox", { name: "Provider API key" }))
      .toHaveValue("old-synthetic-key");
  });
});
