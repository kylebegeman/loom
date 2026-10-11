import { BED_BAND_MM, OVERHANG_ANGLE } from "@t3tools/contracts/fork";
import {
  Color,
  Material,
  MeshLambertMaterial,
  MeshPhongMaterial,
  MeshStandardMaterial,
} from "three";

const PATCH_KEY = "loom-overhangs-v1";
const HATCH_PIXELS = 8;
const WORLD_POSITION = /* glsl */ `
vec4 loomOverhangPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  loomOverhangPosition = batchingMatrix * loomOverhangPosition;
#endif
#ifdef USE_INSTANCING
  loomOverhangPosition = instanceMatrix * loomOverhangPosition;
#endif
vLoomOverhangWorld = ( modelMatrix * loomOverhangPosition ).xyz;
`;
const DECLARATIONS = /* glsl */ `
varying vec3 vLoomOverhangWorld;
uniform bool loomOverhangEnabled;
uniform float loomOverhangSin;
uniform float loomOverhangBedZ;
uniform float loomOverhangBand;
uniform float loomOverhangHatch;
uniform float loomOverhangStripe;
uniform vec3 loomOverhangColor;
`;
const SHADE = /* glsl */ `
if ( loomOverhangEnabled ) {
  vec3 faceNormal = cross( dFdx( vLoomOverhangWorld ), dFdy( vLoomOverhangWorld ) );
  if ( dot( faceNormal, faceNormal ) > 1e-20 ) {
    faceNormal = normalize( faceNormal ) * ( gl_FrontFacing ? 1.0 : -1.0 );
    if ( -faceNormal.z > loomOverhangSin
        && vLoomOverhangWorld.z > loomOverhangBedZ + loomOverhangBand ) {
      float stripe = step( 0.5, fract( ( gl_FragCoord.x + gl_FragCoord.y ) / loomOverhangHatch ) );
      vec3 tint = loomOverhangColor * mix( 1.0, loomOverhangStripe, stripe );
      diffuseColor.rgb = mix( diffuseColor.rgb, tint, 0.75 );
    }
  }
}
`;

/** Patches lit model materials once; every material shares live uniforms with no toggle recompiles. */
export function createOverhangShading() {
  const uniforms = {
    loomOverhangEnabled: { value: false },
    loomOverhangSin: { value: Math.sin((OVERHANG_ANGLE.default * Math.PI) / 180) },
    loomOverhangBedZ: { value: 0 },
    loomOverhangBand: { value: BED_BAND_MM },
    loomOverhangHatch: { value: HATCH_PIXELS },
    loomOverhangStripe: { value: 0.72 },
    loomOverhangColor: { value: new Color(0xd9531e) },
  };
  const patched = new WeakSet<Material>();
  return {
    uniforms,
    patch(material: Material) {
      if (
        !(
          material instanceof MeshStandardMaterial ||
          material instanceof MeshPhongMaterial ||
          material instanceof MeshLambertMaterial
        )
      )
        return false;
      if (patched.has(material)) return true;
      patched.add(material);
      const compile = material.onBeforeCompile;
      const cacheKey = material.customProgramCacheKey;
      // Three's default key reads onBeforeCompile dynamically; retain the original callback's key.
      const compileKey = compile.toString();
      material.customProgramCacheKey = () =>
        `${
          cacheKey === Material.prototype.customProgramCacheKey
            ? compileKey
            : cacheKey.call(material)
        }|${PATCH_KEY}`;
      material.onBeforeCompile = (shader, renderer) => {
        compile.call(material, shader, renderer);
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader =
          "varying vec3 vLoomOverhangWorld;\n" +
          shader.vertexShader.replace(
            "#include <project_vertex>",
            "#include <project_vertex>\n" + WORLD_POSITION,
          );
        shader.fragmentShader =
          DECLARATIONS +
          shader.fragmentShader.replace(
            "#include <normal_fragment_maps>",
            "#include <normal_fragment_maps>\n" + SHADE,
          );
      };
      material.needsUpdate = true;
      return true;
    },
    setEnabled(value: boolean) {
      uniforms.loomOverhangEnabled.value = value;
    },
    setAngle(degrees: number) {
      if (!Number.isFinite(degrees)) return;
      const angle = Math.max(OVERHANG_ANGLE.minimum, Math.min(OVERHANG_ANGLE.maximum, degrees));
      uniforms.loomOverhangSin.value = Math.sin((angle * Math.PI) / 180);
    },
    setBedZ(z: number) {
      uniforms.loomOverhangBedZ.value = z;
    },
    setTheme(dark: boolean) {
      uniforms.loomOverhangColor.value.setHex(dark ? 0xff8a4c : 0xd9531e);
    },
    setPixelRatio(ratio: number) {
      uniforms.loomOverhangHatch.value = HATCH_PIXELS * ratio;
    },
  };
}
