export const LOOM_VAULT_INSTRUCTIONS = `
## Loom Vault development access

When exposed by this Loom server, use \`loom_vault_ssh_exec\` and \`loom_vault_git\` for granted development SSH and Git work. They use the authenticated current thread/run, automatically sign and release a workload, and execute on the Loom server. They do not configure the terminal's SSH agent or personal password manager. Use item references and the current item version; never put private keys, tokens or secret output in prompts or arguments. Git needs its exact repository destination grant. A denial, unconfigured broker or untrusted host requires an administrator's action; do not bypass it with personal credentials or repeated retries. These instructions grant no access. Scheduled agent runs use the same tools and policy; command-only jobs do not.
`;
