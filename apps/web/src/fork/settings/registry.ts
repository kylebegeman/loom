/** Topic metadata only: settings search loads this at startup, so components live in pages.tsx. */
export type ForkSettingsTopicId =
  | "skill-registry"
  | "project-profiles"
  | "project-lifecycle"
  | "mini-offload"
  | "apple-build-tooling"
  | "device-qa"
  | "preview-links"
  | "panel-picker"
  | "code-graph"
  | "pcb-preview"
  | "model-preview-3d"
  | "vault"
  | "vault-github"
  | "vault-profiles"
  | "vault-access"
  | "vault-test-accounts"
  | "vault-passwords"
  | "vault-brokers"
  | "vault-health"
  | "vault-migration"
  | "vault-migration-inventory";

export type ForkSettingsHome =
  | "/settings/vault"
  | "/settings/tools"
  | "/settings/general"
  | "/settings/devices"
  | "/settings/worktrees"
  | "/settings/connections"
  | "/settings/access"
  | "/settings/projects";

export interface ForkSettingsSection {
  readonly id: ForkSettingsTopicId;
  readonly title: string;
  readonly description: string;
  readonly home: ForkSettingsHome;
  /** Folded under the Vault page's Advanced disclosure. */
  readonly advanced?: true;
  readonly keywords: string;
  readonly scope: "computer" | "device" | "mixed" | "project";
}

export const FORK_SETTINGS_SECTIONS: ReadonlyArray<ForkSettingsSection> = [
  {
    id: "skill-registry",
    title: "Skills",
    description:
      "Manage provider skills, install complete skill folders from git, and create or test skills in the Lab.",
    home: "/settings/tools",
    keywords: "skills sources lab git install providers accounts enable disable",
    scope: "computer",
  },
  {
    id: "project-profiles",
    title: "Project profile",
    description: "Keep private notes, command mappings, env metadata and advisory token budgets.",
    home: "/settings/projects",
    keywords: "notes commands budgets tokens env schema varlock private",
    scope: "project",
  },
  {
    id: "project-lifecycle",
    scope: "computer",
    title: "Lanes",
    description: "Control checkout lanes, their disk limits and temporary files.",
    home: "/settings/worktrees",
    keywords:
      "storage disk cleanup space reserve cap xcode derived data build slots shell terminal lanes",
  },
  {
    id: "mini-offload",
    scope: "computer",
    title: "Command workers",
    description: "Connect and manage computers that run command jobs.",
    home: "/settings/connections",
    keywords: "remote mini offload jobs workers computers connection",
  },
  {
    id: "apple-build-tooling",
    scope: "computer",
    title: "Apple builds",
    description: "Configure Xcode builds, simulators, diagnostics, and run history.",
    home: "/settings/devices",
    keywords: "apple xcode derived data simulator tests xcbeautify diagnostics history",
  },
  {
    id: "device-qa",
    scope: "computer",
    title: "Device QA",
    description: "Set up device testing tools and screenshot limits.",
    home: "/settings/devices",
    keywords: "ios android simulator emulator screenshots testing device qa agent",
  },
  {
    id: "preview-links",
    scope: "computer",
    title: "Preview links",
    description: "Configure sharing, tunnel access, and open preview links.",
    home: "/settings/access",
    keywords: "cloudflare connector token tunnel gateway port share browser links pages",
  },
  {
    id: "panel-picker",
    scope: "device",
    title: "Panel picker",
    description: "Choose the panel launcher and its keyboard shortcut.",
    home: "/settings/general",
    keywords:
      "panel picker launcher compact search recent shortcut keybindings terminal browser device",
  },
  {
    id: "code-graph",
    scope: "computer",
    title: "Code map",
    description: "Configure code indexing and manage project graphs.",
    home: "/settings/tools",
    keywords: "code map graphify index query search nodes cache command agent graph",
  },
  {
    id: "pcb-preview",
    scope: "mixed",
    title: "Circuit boards",
    description: "Check circuit tools and choose how designs open and display.",
    home: "/settings/tools",
    keywords: "pcb preview kicad tscircuit bun circuit electronics fabrication units checks",
  },
  {
    id: "model-preview-3d",
    scope: "computer",
    title: "3D models",
    description: "Configure model previews, print tools, units, and render storage.",
    home: "/settings/tools",
    keywords: "3d openscad python cad slicer printer nozzle layer bed volume overhang units cache",
  },
  {
    id: "vault",
    scope: "computer",
    title: "Vault items",
    description: "Search, copy references and manage Vault items and agent access.",
    home: "/settings/vault",
    keywords:
      "vault openbao status secrets credentials records unlock environment reference references search archive restore item",
  },
  {
    id: "vault-github",
    scope: "computer",
    title: "GitHub for agents",
    description: "Connect a dedicated GitHub identity for repository access.",
    home: "/settings/vault",
    keywords:
      "vault github token app installation repository repositories git https gh credentials",
  },
  {
    id: "vault-profiles",
    scope: "computer",
    title: "Project connections",
    description: "Choose the connections a project needs for development.",
    home: "/settings/vault",
    keywords: "vault profile profiles project binding requirements github ssh git default",
  },
  {
    id: "vault-access",
    scope: "computer",
    title: "Access",
    description: "Review who can inspect, manage, or use Vault records.",
    home: "/settings/vault",
    keywords:
      "vault grants permission permissions policy approval requests allow deny access audit expiry",
  },
  {
    id: "vault-test-accounts",
    scope: "computer",
    title: "Test accounts",
    description: "Organize accounts used for development and verification.",
    home: "/settings/vault",
    keywords: "vault test account collection verification login role synthetic",
  },
  {
    id: "vault-passwords",
    title: "Password generator",
    description: "Generate passwords locally without connecting a Vault.",
    home: "/settings/vault",
    keywords: "vault password generator random local device clipboard tools",
    scope: "device",
  },
  {
    id: "vault-brokers",
    scope: "computer",
    title: "Credential brokers",
    description: "Enroll and manage the brokers that deliver development credentials.",
    home: "/settings/vault",
    advanced: true,
    keywords: "vault broker ssh terminal enroll invitation fingerprint trust credential",
  },
  {
    id: "vault-health",
    scope: "computer",
    title: "Health & recovery",
    description: "Check Vault health, review maintenance, and manage recovery evidence.",
    home: "/settings/vault",
    advanced: true,
    keywords: "vault openbao health backup recovery maintenance audit rotation cleanup retention",
  },
  {
    id: "vault-migration",
    scope: "computer",
    title: "Imports",
    description: "Review local records before importing them into Vault.",
    home: "/settings/vault",
    advanced: true,
    keywords:
      "vault migration import imports development credentials local review archive typed ssh github",
  },
  {
    id: "vault-migration-inventory",
    scope: "computer",
    title: "Import plans",
    description: "Inspect development dependencies and prepare scoped replacements.",
    home: "/settings/vault",
    advanced: true,
    keywords:
      "vault migration plans inventory git remote replacement source import plan dependencies",
  },
];
