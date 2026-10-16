// The scope rule is shared with the server, which ranks launch candidates for agents.
export { libraryCopiesForScope } from "@t3tools/shared/fork/library-launch";

/** File preparation waits for the existing-copy catalog, including retries and refreshes. */
export function libraryCopyReadiness(query: {
  readonly isPending: boolean;
  readonly isSuccess: boolean;
  readonly error: string | null;
}): "loading" | "error" | "ready" {
  if (query.isPending) return "loading";
  if (query.error !== null) return "error";
  return query.isSuccess ? "ready" : "loading";
}
