import type { EnvironmentId } from "../baseSchemas.ts";

export type VaultPromptLink =
  | {
      readonly kind: "profile";
      readonly environmentId: string;
      readonly id: string;
      readonly version: number;
    }
  | { readonly kind: "reference"; readonly environmentId: string; readonly id: string };
export type VaultPromptAttachment = VaultPromptLink & {
  readonly start: number;
  readonly end: number;
  readonly label: string;
};
export type VaultPromptParse =
  | { readonly valid: true; readonly attachments: ReadonlyArray<VaultPromptAttachment> }
  | { readonly valid: false; readonly attachments: ReadonlyArray<VaultPromptAttachment> };
const labelText = (label: string) => label.replace(/[\\[\]<>\r\n]/g, " ").slice(0, 120);
export const vaultPromptLink = (link: VaultPromptLink, label: string) =>
  `[Vault ${link.kind === "profile" ? "profile" : "reference"}: ${labelText(label)}](${link.kind === "profile" ? "loom-vault-profile" : "loom-vault"}:${encodeURIComponent(link.environmentId)}:${link.id}${link.kind === "profile" ? `:${link.version}` : ""})`;

/** Only explicit standalone Markdown links declare launch requirements; quoted/code examples do not. */
export function readVaultPrompt(text: string): VaultPromptParse {
  const attachments: VaultPromptAttachment[] = [];
  let offset = 0,
    fence: string | null = null,
    valid = true;
  for (const line of text.split("\n")) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
    } else if (
      fence === null &&
      !/^(?: {4}|\t)/.test(line) &&
      /^\s*\[Vault (?:profile|reference):/.test(line)
    ) {
      const match =
        /^\s*\[Vault (profile|reference): ([^\]\n]*)\]\((loom-vault(?:-profile)?):([^:()\s]+):([a-f0-9]{32})(?::([1-9][0-9]*))?\)\s*$/.exec(
          line,
        );
      if (!match) {
        valid = false;
      } else {
        const [, type, label, scheme, encoded, id, version] = match;
        let environmentId: string | null = null;
        try {
          environmentId = decodeURIComponent(encoded!);
        } catch {
          valid = false;
        }
        if (
          !environmentId ||
          encodeURIComponent(environmentId) !== encoded ||
          (type === "profile"
            ? scheme !== "loom-vault-profile" || !version || !Number.isSafeInteger(Number(version))
            : scheme !== "loom-vault" || !!version)
        )
          valid = false;
        else
          attachments.push(
            type === "profile"
              ? {
                  kind: "profile",
                  environmentId,
                  id: id!,
                  version: Number(version),
                  label: label!,
                  start: offset,
                  end: offset + line.length,
                }
              : {
                  kind: "reference",
                  environmentId,
                  id: id!,
                  label: label!,
                  start: offset,
                  end: offset + line.length,
                },
          );
      }
    }
    offset += line.length + 1;
  }
  if (
    attachments.filter((a) => a.kind === "profile").length > 1 ||
    attachments.length > 17 ||
    new Set(
      attachments.filter((a) => a.kind === "reference").map((a) => `${a.environmentId}:${a.id}`),
    ).size !== attachments.filter((a) => a.kind === "reference").length
  )
    valid = false;
  return { valid, attachments };
}
export function removeVaultPromptAttachment(
  text: string,
  attachment: VaultPromptAttachment,
): string {
  const before = text.slice(0, attachment.start),
    after = text.slice(attachment.end);
  return after.trim() === ""
    ? before.replace(/(?:\r?\n){1,2}$/, "")
    : before + after.replace(/^\r?\n/, "");
}
export function attachVaultPrompt(text: string, link: VaultPromptLink, label: string): string {
  const parsed = readVaultPrompt(text);
  const replace = parsed.attachments.filter((a) =>
    link.kind === "profile"
      ? a.kind === "profile"
      : a.kind === "reference" && a.environmentId === link.environmentId && a.id === link.id,
  );
  let next = text;
  for (let index = replace.length - 1; index >= 0; index--)
    next = removeVaultPromptAttachment(next, replace[index]!);
  return `${next.trimEnd()}${next.trim() ? "\n\n" : ""}${vaultPromptLink(link, label)}`;
}
export const vaultPromptEnvironmentMatches = (
  links: ReadonlyArray<VaultPromptAttachment>,
  environmentId: EnvironmentId,
) => links.every((a) => a.environmentId === environmentId);
