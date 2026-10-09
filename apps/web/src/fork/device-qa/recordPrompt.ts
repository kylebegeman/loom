import { DEVICE_QA_FLOWS_DIR, isArgentFlowName } from "@t3tools/contracts/fork";

export interface RecordPromptInput {
  readonly name: string;
  /** Folder under `.argent/flows`; "" for the root. */
  readonly folder: string;
  readonly description: string;
  readonly device: { readonly name: string; readonly platform: string; readonly deviceId: string };
}

/** Why the form cannot build a prompt yet, or null. */
export function recordPromptProblem(input: Pick<RecordPromptInput, "name" | "folder">) {
  if (input.name.length === 0) return "Name the flow.";
  if (!isArgentFlowName(input.name)) return "Use letters, numbers, _ and - in the flow name.";
  const folder = normalizeFolder(input.folder);
  if (folder.split("/").some((part) => part !== "" && !isArgentFlowName(part)))
    return "Use letters, numbers, _ and - in folder names, separated by /.";
  return null;
}

const normalizeFolder = (folder: string) =>
  folder
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");

/** The "Record with the agent" prompt placed in the composer. */
export function recordPrompt(input: RecordPromptInput) {
  const folder = normalizeFolder(input.folder);
  const file = `${DEVICE_QA_FLOWS_DIR}/${folder === "" ? "" : `${folder}/`}${input.name}.yaml`;
  const { device } = input;
  return [
    `Record an argent flow named "${input.name}" in ${file} on ${device.name}`,
    `(${device.platform}, id ${device.deviceId}). Path: ${input.description.trim().replace(/[.\s]+$/, "")}.`,
    "Use argent's flow recording tools (flow-start-recording, flow-add-step, flow-add-echo,",
    "flow-finish-recording). Add an echo label before each screen change and prefer ids or",
    "text over coordinates.",
  ].join(" ");
}
