import * as Layer from "effect/Layer";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as OpenBaoStore from "./OpenBaoStore.ts";
import * as AccountVaultMachineClient from "./AccountVaultMachineClient.ts";
import * as LibraryConnection from "../project-library/LibraryConnection.ts";
import * as VaultCore from "./VaultCore.ts";
import * as VaultProviderCredentials from "./VaultProviderCredentials.ts";

export const layerStore = OpenBaoStore.layer.pipe(Layer.provide(FetchHttpClient.layer));
export const layerMachineClient = AccountVaultMachineClient.layer.pipe(
  Layer.provide(
    Layer.merge(LibraryConnection.layer.pipe(Layer.provide(FetchHttpClient.layer)), layerStore),
  ),
);
export const layerCore = VaultCore.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      layerStore,
      layerMachineClient,
      LibraryConnection.layer.pipe(Layer.provide(FetchHttpClient.layer)),
    ),
  ),
);
export const layerProviderCredentials = VaultProviderCredentials.layer.pipe(
  Layer.provide(Layer.mergeAll(layerCore, layerStore, layerMachineClient)),
);
