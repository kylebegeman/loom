import { VaultSshAgentRunInput, VAULT_SSH_COMMAND_TIMEOUT_MAX_MS } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as SchemaIssue from "effect/SchemaIssue";

export class SshAgentInputError extends Schema.TaggedError<SshAgentInputError>()(
  "SshAgentInputError",
  {
    problem: Schema.String,
  },
) {
  override get message() {
    return `Invalid ssh-agent-exec input: ${this.problem}`;
  }
}
const fields = new Set([
  "connection",
  "id",
  "expectedVersion",
  "resource",
  "preferredItemIds",
  "command",
  "tool",
  "argv",
  "timeoutMs",
]);
const pathText = (path: ReadonlyArray<PropertyKey>) =>
  path
    .map((part, index) =>
      typeof part === "number"
        ? `[${part}]`
        : fields.has(String(part))
          ? `${index ? "." : ""}${String(part)}`
          : ".[unexpected field]",
    )
    .join("") || "request";
const describe = (issue: SchemaIssue.Issue, path: ReadonlyArray<PropertyKey> = []): string => {
  switch (issue._tag) {
    case "Pointer":
      return describe(issue.issue, [...path, ...issue.path]);
    case "Composite":
    case "AnyOf":
      return [...new Set(issue.issues.map((child) => describe(child, path)))]
        .slice(0, 4)
        .join("; ");
    case "Encoding":
      return describe(issue.issue, path);
    case "UnexpectedKey":
      return `Unexpected field at ${pathText(path)}. Remove it.`;
    case "MissingKey":
      return `${pathText(path)} is required.`;
    default: {
      const name = pathText(path);
      if (name === "timeoutMs")
        return `timeoutMs must be an integer from 100 to ${VAULT_SSH_COMMAND_TIMEOUT_MAX_MS} milliseconds (24 hours). The signing lease lasts five minutes; an authenticated command may continue until its deadline.`;
      if (name.startsWith("command.argv["))
        return `${name} must be a string of at most 4096 characters without a NUL character.`;
      if (name === "command.argv") return "command.argv must contain 1 to 64 strings.";
      if (name === "command.tool") return "command.tool must be ssh or git.";
      return `${name} does not match its required type or allowed format.`;
    }
  }
};
const decode = Schema.decodeUnknownEffect(VaultSshAgentRunInput, {
  onExcessProperty: "error",
  errors: "all",
  reportInput: false,
});
export const validateSshAgentInput = Effect.fn("SshAgentInput.validate")(function* (
  input: unknown,
) {
  return yield* decode(input).pipe(
    Effect.mapError((error) => new SshAgentInputError({ problem: describe(error.issue) })),
  );
});
const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));
export const decodeSshAgentInput = Effect.fn("SshAgentInput.decode")(function* (input: string) {
  const value = yield* decodeJson(input).pipe(
    Effect.mapError(() => new SshAgentInputError({ problem: "Provide valid JSON." })),
  );
  return yield* validateSshAgentInput(value);
});
