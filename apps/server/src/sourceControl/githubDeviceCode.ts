/** Parse only gh's public device code, including fragmented or ANSI-decorated output. */
export function parseGitHubDeviceCode(output: string): string | null {
  // gh may apply terminal colors even when launched by a service.
  // eslint-disable-next-line no-control-regex -- Strip ANSI escape controls emitted by gh.
  const plain = output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
  return (
    /First copy your one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})(?![A-Z0-9-])/.exec(plain)?.[1] ??
    null
  );
}
