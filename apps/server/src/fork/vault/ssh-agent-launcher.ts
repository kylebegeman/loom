import type { VaultSshAgentSession } from "@t3tools/contracts/fork";
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
// Lets the command name its connection the way it was selected, such as "personal-vps". An alias
// only names the pinned destination: ssh still connects to the pinned host, user and port.
const HOST_ALIAS = /^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/;

// Git supplies its SSH arguments after this executable. Validate the destination before ssh
// sees it; an agent authentication signature alone cannot prove a network hostname or port.
export const renderAgentSshLauncher = (
  session: VaultSshAgentSession,
  paths: { socket: string; identity: string; knownHosts: string },
  aliases: ReadonlyArray<string> = [],
) => {
  const { target } = session;
  const destinations = new Set([
    target.hostname,
    `${target.username}@${target.hostname}`,
    `ssh://${target.username}@${target.hostname}:${target.port}`,
    ...aliases.flatMap((alias) =>
      HOST_ALIAS.test(alias) ? [alias, `${target.username}@${alias}`] : [],
    ),
  ]);
  const options = [
    "BatchMode=yes",
    "IdentitiesOnly=yes",
    `IdentityAgent=${paths.socket}`,
    `IdentityFile=${paths.identity}`,
    "AddKeysToAgent=no",
    "PasswordAuthentication=no",
    "KbdInteractiveAuthentication=no",
    "PreferredAuthentications=publickey",
    "PubkeyAuthentication=host-bound",
    "HostKeyAlgorithms=ssh-ed25519",
    `UserKnownHostsFile=${paths.knownHosts}`,
    "GlobalKnownHostsFile=/dev/null",
    "StrictHostKeyChecking=yes",
    "UpdateHostKeys=no",
    "VerifyHostKeyDNS=no",
    "CanonicalizeHostname=no",
    "ProxyCommand=none",
    "ProxyJump=none",
    "ForwardAgent=no",
    "ClearAllForwardings=yes",
    "ControlMaster=no",
    "ControlPath=none",
    "ControlPersist=no",
    "PermitLocalCommand=no",
    "EscapeChar=none",
    "ConnectionAttempts=1",
    "ConnectTimeout=10",
    "SendEnv=GIT_PROTOCOL",
  ];
  return `#!/bin/sh
fail() { printf '%s\\n' 'Loom Vault refused an unsupported SSH option or a different destination.' >&2; exit 64; }
verbosity=
while [ "$#" -gt 0 ]; do
  case "$1" in
    -T) shift ;;
    -v|-vv|-vvv) verbosity="$1"; shift ;;
    -p) [ "$#" -ge 2 ] && [ "$2" = ${quote(String(target.port))} ] || fail; shift 2 ;;
    -l) [ "$#" -ge 2 ] && [ "$2" = ${quote(target.username)} ] || fail; shift 2 ;;
    -o) [ "$#" -ge 2 ] && [ "$2" = 'SendEnv=GIT_PROTOCOL' ] || fail; shift 2 ;;
    --) shift; break ;;
    -*) fail ;;
    *) break ;;
  esac
done
[ "$#" -gt 0 ] || fail
case "$1" in
  ${[...destinations].map(quote).join("|")}) shift ;;
  *) fail ;;
esac
exec /usr/bin/ssh $verbosity -F none ${options.flatMap((option) => ["-o", quote(option)]).join(" ")} -T -p ${target.port} -l ${quote(target.username)} -- ${quote(target.hostname)} "$@"
`;
};
