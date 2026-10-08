import { ChevronRightIcon } from "lucide-react";
import type { AppleToolchain } from "@t3tools/contracts/fork";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import { CopyCommand, Muted } from "./parts";

interface Problem {
  readonly text: string;
  readonly command?: string;
}

/** Toolchain problems with the command that fixes each; the user runs them, never Loom. */
export function toolchainProblems(toolchain: AppleToolchain): ReadonlyArray<Problem> {
  if (toolchain.platform !== "darwin") return [];
  const problems: Problem[] = [];
  if (toolchain.xcodeVersion === null)
    problems.push({
      text: "Xcode is not installed. Install it from the App Store, then open it once.",
    });
  if (toolchain.developerDirIsCommandLineTools)
    problems.push({
      text: "Xcode command line tools point at CommandLineTools, not Xcode.",
      command: "sudo xcode-select -s /Applications/Xcode.app/Contents/Developer",
    });
  if (toolchain.firstLaunchPending)
    problems.push({
      text: "Xcode needs first-launch setup.",
      command: "xcodebuild -runFirstLaunch",
    });
  if (
    toolchain.xcodeVersion !== null &&
    !toolchain.runtimes.some((runtime) => runtime.platform === "iOS")
  )
    problems.push({
      text: "No simulator runtime for iOS.",
      command: "xcodebuild -downloadPlatform iOS",
    });
  return problems;
}

const helper = (name: string, path: string | null) =>
  path ? `${name} installed` : `${name} not installed`;

export function ToolchainCard({ toolchain }: { toolchain: AppleToolchain }) {
  const problems = toolchainProblems(toolchain);
  return (
    <div className="flex flex-col gap-2">
      {problems.map((problem) => (
        <div key={problem.text} role="alert" className="flex flex-col gap-1 text-sm">
          <p>{problem.text}</p>
          {problem.command && <CopyCommand command={problem.command} />}
        </div>
      ))}
      <Collapsible defaultOpen={problems.length > 0}>
        <CollapsibleTrigger className="group flex items-center gap-1 text-muted-foreground text-sm">
          <ChevronRightIcon className="size-3.5 transition-transform group-data-panel-open:rotate-90" />
          {toolchain.xcodeVersion ?? "Xcode not found"}
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <ul className="flex flex-col gap-0.5 pt-1 pl-5 text-muted-foreground text-xs">
            {toolchain.developerDir && <li className="break-all">{toolchain.developerDir}</li>}
            <li>
              Simulator runtimes:{" "}
              {toolchain.runtimes.length === 0
                ? "none"
                : toolchain.runtimes
                    .map((runtime) => `${runtime.platform} ${runtime.version}`)
                    .join(", ")}
            </li>
            <li>
              {helper("xcodegen", toolchain.tools.xcodegen)},{" "}
              {helper("xcbeautify", toolchain.tools.xcbeautify)}
            </li>
            <li>
              Xcode MCP server:{" "}
              {toolchain.tools.mcpbridge
                ? (toolchain.tools.mcpServerHeadless ?? "available (needs a running Xcode)")
                : "not available"}
            </li>
          </ul>
        </CollapsiblePanel>
      </Collapsible>
      {toolchain.tools.xcbeautify === null && (
        <Muted>Install xcbeautify for a more readable log.</Muted>
      )}
    </div>
  );
}
