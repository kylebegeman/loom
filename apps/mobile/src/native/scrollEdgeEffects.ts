// Avoid RN/navigation imports so node checks do not load their untranspiled Flow.

export type NativeTopScrollEdgeEffect = "automatic" | "soft";
export type NativeHeaderScrollEdgeEffects = {
  readonly top: NativeTopScrollEdgeEffect;
  readonly bottom: "hidden";
  readonly left: "hidden";
  readonly right: "hidden";
};

function nativeTopScrollEdgeEffect(
  os: string,
  _version: number | string,
): NativeTopScrollEdgeEffect {
  return os === "ios" ? "soft" : "automatic";
}

export function nativeHeaderScrollEdgeEffects(
  os: string,
  version: number | string,
): NativeHeaderScrollEdgeEffects {
  return {
    top: nativeTopScrollEdgeEffect(os, version),
    bottom: "hidden",
    left: "hidden",
    right: "hidden",
  };
}
