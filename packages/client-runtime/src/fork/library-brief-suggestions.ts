import {
  BRIEF_SUGGESTION_RUNS_PER_DAY,
  type LibraryBriefSuggestion,
  type LibraryBriefSuggestionMode,
} from "@t3tools/contracts/fork";

export type LibraryBriefSuggestionChoice = LibraryBriefSuggestionMode;

/** The project setting's choices, in the order a person reads them. */
export const LIBRARY_BRIEF_SUGGESTION_CHOICES: ReadonlyArray<{
  readonly value: LibraryBriefSuggestionChoice;
  readonly label: string;
  readonly description: string;
}> = [
  { value: "off", label: "Off", description: "Only when someone asks from a conversation." },
  {
    value: "ask",
    label: "Ask first",
    description: "Offer a suggestion on each settled conversation and wait for a yes.",
  },
  {
    value: "automatic",
    label: "Automatic",
    description: `Suggest as soon as a conversation settles, up to ${BRIEF_SUGGESTION_RUNS_PER_DAY} a day on each computer.`,
  },
];

/** A saved project without the setting is off. */
export const libraryBriefSuggestionChoice = (
  mode: LibraryBriefSuggestionMode | undefined,
): LibraryBriefSuggestionChoice => mode ?? "off";

export const libraryBriefSuggestionChoiceLabel = (mode: LibraryBriefSuggestionMode | undefined) =>
  LIBRARY_BRIEF_SUGGESTION_CHOICES.find(
    (choice) => choice.value === libraryBriefSuggestionChoice(mode),
  )?.label ?? "Off";

/** Off is saved as no setting, so a profile that only turns it off stays empty. */
export const libraryBriefSuggestionDraftValue = (
  choice: LibraryBriefSuggestionChoice,
): LibraryBriefSuggestionMode | undefined => (choice === "off" ? undefined : choice);

export type LibraryBriefSuggestionNotice =
  | { readonly kind: "offer"; readonly text: string }
  | { readonly kind: "status"; readonly text: string; readonly proposed: boolean };

/**
 * What a saved conversation shows about its automatic brief suggestion, or null when there is
 * nothing to say: no suggestion, or someone said not now.
 */
export function libraryBriefSuggestionNotice(
  suggestion: LibraryBriefSuggestion | null,
): LibraryBriefSuggestionNotice | null {
  if (!suggestion) return null;
  if (suggestion.proposalId !== undefined)
    return {
      kind: "status",
      proposed: true,
      text: "An agent suggested a brief update from this conversation. Review it on the project page.",
    };
  switch (suggestion.status) {
    case "offered":
      return {
        kind: "offer",
        text: "This project can have an agent read this conversation and suggest brief updates.",
      };
    case "starting":
    case "started":
      return {
        kind: "status",
        proposed: false,
        text: "An agent is reading this conversation for brief updates. Anything it suggests waits on the project page.",
      };
    case "skipped":
      return {
        kind: "status",
        proposed: false,
        text:
          suggestion.reason === "daily-limit"
            ? `Skipped a brief suggestion: this project already had ${BRIEF_SUGGESTION_RUNS_PER_DAY} today on this computer.`
            : "Could not start a brief suggestion for this conversation.",
      };
    case "declined":
      return null;
  }
}
