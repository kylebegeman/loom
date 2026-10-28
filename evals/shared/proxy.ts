// Eval-only helper: it reads the local Codex config through python3 at startup.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as Schema from "effect/Schema";

// Read credentials into memory only. Python's TOML parser avoids another runner dependency.
const decodeProxyConfig = Schema.decodeUnknownSync(
  Schema.Struct({ url: Schema.String, headers: Schema.Record(Schema.String, Schema.String) }),
);
/** Reads the explicitly selected OpenAI-compatible eval provider; defaults to vibeproxy. */
export const proxyConfig = () =>
  decodeProxyConfig(
    JSON.parse(
      NodeChildProcess.execFileSync(
        "python3",
        [
          "-c",
          `
import json, os, pathlib, tomllib
home = pathlib.Path.home() / '.codex'
provider = os.environ.get('T3_EVAL_CODEX_PROVIDER', 'vibeproxy')
p = tomllib.loads((home / 'config.toml').read_text()).get('model_providers', {}).get(provider)
if p is None: raise SystemExit('Configure the named Codex eval provider or set T3_EVAL_CODEX_PROVIDER to an existing compatible provider.')
h = p.get('http_headers', {}).copy()
h.update({k: os.environ[v] for k,v in p.get('env_http_headers', {}).items()})
key = os.environ.get('T3_EVAL_PROXY_API_KEY') or (os.environ[p['env_key']] if p.get('env_key') else p.get('experimental_bearer_token'))
if not key and p.get('requires_openai_auth'): key = json.loads((home / 'auth.json').read_text()).get('OPENAI_API_KEY')
if key: h['Authorization'] = 'Bearer ' + key
print(json.dumps({'url': p['base_url'].rstrip('/'), 'headers': h}))
`,
        ],
        { encoding: "utf8" },
      ),
    ),
  );
