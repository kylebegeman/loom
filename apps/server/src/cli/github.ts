import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import * as GitHubHostSetup from "../sourceControl/GitHubHostSetup.ts";

const setupLayer = GitHubHostSetup.layer.pipe(Layer.provide(FetchHttpClient.layer));

const encodeStatus = Schema.encodeSync(Schema.fromJsonString(GitHubHostSetup.GitHubHostStatus));

const repository = Flag.String("repository").pipe(
  Flag.withDescription("Verify noninteractive Git access to this HTTPS GitHub repository."),
  Flag.optional,
);

export const setupGitHubHost = (interactive: boolean, repository?: string) =>
  Effect.gen(function* () {
    const setup = yield* GitHubHostSetup.GitHubHostSetup;
    return yield* setup.setup({ interactive, ...(repository === undefined ? {} : { repository }) });
  }).pipe(Effect.provide(setupLayer));

const setup = Command.make("setup", {
  repository,
  nonInteractive: Flag.Boolean("non-interactive").pipe(
    Flag.withDescription(
      "Install or reuse the CLI and saved sign-in; never start browser authorization.",
    ),
    Flag.withDefault(false),
  ),
}).pipe(
  Command.withDescription(
    "Prepare GitHub CLI, reuse sign-in or request one device approval, and configure Git.",
  ),
  Command.withHandler((flags) =>
    setupGitHubHost(!flags.nonInteractive, Option.getOrUndefined(flags.repository)).pipe(
      Effect.andThen(
        Console.log(
          "GitHub is ready for Git on this machine. Saved authorization is reused across projects and lanes.",
        ),
      ),
    ),
  ),
);
const status = Command.make("status", {
  repository,
  json: Flag.Boolean("json").pipe(Flag.withDefault(false)),
}).pipe(
  Command.withDescription(
    "Check this machine's GitHub sign-in and optional private-repository Git access without changing anything.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const setup = yield* GitHubHostSetup.GitHubHostSetup;
      const result = yield* setup.status(Option.getOrUndefined(flags.repository));
      yield* Console.log(
        flags.json
          ? encodeStatus(result)
          : `GitHub: ${result.state}${result.state === "missing-cli" || result.state === "sign-in-required" ? ". Run `t3 github setup` on this machine." : ""}`,
      );
    }).pipe(Effect.provide(setupLayer)),
  ),
);
export const githubCommand = Command.make("github").pipe(
  Command.withDescription("Set up persistent GitHub access for this host."),
  Command.withSubcommands([setup, status]),
);
