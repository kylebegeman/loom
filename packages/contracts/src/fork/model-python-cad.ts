import * as Schema from "effect/Schema";

export const TESTED_BUILD123D_VERSION = "0.13.0";
export const MANAGED_PYTHON_VERSION = "3.13";
/** Explicit host setup commands. Loom never installs into a custom interpreter. */
export const pythonInstallCommands = (venv: string) => [
  `uv venv --no-config --python ${MANAGED_PYTHON_VERSION} "${venv}"`,
  `uv pip install --no-config --python "${venv}" --only-binary :all: build123d==${TESTED_BUILD123D_VERSION}`,
];
export const PythonCadInfo = Schema.Struct({
  state: Schema.Literals(["ready", "not-set-up", "missing-build123d", "broken", "setting-up"]),
  managed: Schema.Boolean,
  path: Schema.NullOr(Schema.String),
  pythonVersion: Schema.NullOr(Schema.String),
  build123dVersion: Schema.NullOr(Schema.String),
  uv: Schema.NullOr(Schema.String),
  installCommands: Schema.Array(Schema.String),
  detail: Schema.NullOr(Schema.String),
});
export type PythonCadInfo = typeof PythonCadInfo.Type;
