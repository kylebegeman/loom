import * as Layer from "effect/Layer";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as OpenBaoStore from "./OpenBaoStore.ts";
import * as VaultCore from "./VaultCore.ts";
import * as VaultProviderCredentials from "./VaultProviderCredentials.ts";

export const layerStore = OpenBaoStore.layer.pipe(Layer.provide(FetchHttpClient.layer));
export const layerCore = VaultCore.layer.pipe(Layer.provide(layerStore));
export const layerProviderCredentials = VaultProviderCredentials.layer.pipe(
  Layer.provide(Layer.merge(layerCore, layerStore)),
);
