# Loom skill workflow eval

Reuses mcp-tool-use's model clients, harness captures and action graders. Every run
reads the actual skill files and shared runtime contract, then generates cases in its
output folder. No skill text is copied into the eval.

From evals:

```sh
node --env-file-if-exists=../.env fork/skills/run.ts --model gpt-6.1-sol \
  --case delivery-emphasis-is-ordinary-prose --samples 1 --out runs/loom-skills-setup
node --env-file-if-exists=../.env fork/skills/run.ts --model gpt-6.1-sol \
  --samples 3 --concurrency 2 --out runs/loom-skills
```

The scenarios guard explicit delivery triggers, a ready full-stop handoff, exact
review-model selection and the no-recursive-dispatch bot boundary, Library recall, isolated Browser use, untrusted intake and workload-aware performance. Shell calls are
canned and no product operations execute. Codex uses the existing CLIProxyAPI setup;
Claude uses the API key documented by mcp-tool-use. Run cost/usage and failures are
recorded by that runner. A scenario error or missing credential is not a pass.

These cases validate workflow decisions. Native provider discovery and invocation
metadata need the separate native pack validator and provider catalog checks.

Validate provider metadata, dependency closure and source licenses from the repo root:

```sh
node apps/server/scripts/verify-loom-skills.ts
```

For another configured compatible gateway, set `T3_EVAL_CODEX_PROVIDER` to its
provider name. `T3_EVAL_PROXY_API_KEY` supplies a credential only to this eval
process when that provider does not declare one. Keep the value in the private
secret card or the gateway's existing credential store, never in command arguments
or committed files. This does not change the gateway or global provider settings.
