// Reference sources are loaded only by this benchmark-specific test configuration.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeURL from "node:url";
import { defineConfig, mergeConfig } from "vite-plus";
import baseConfig from "../../vite.config.ts";
import { sourceReferencePlugin } from "./sourceReference.ts";

const root = NodeURL.fileURLToPath(new URL("../../", import.meta.url));
const reference = process.env.LOOM_PERF_REFERENCE;

export default mergeConfig(
  baseConfig,
  defineConfig({
    plugins: reference
      ? [sourceReferencePlugin(root, reference, process.env.LOOM_PERF_REFERENCE_AUDIT_OUTPUT)]
      : [],
  }),
);
