import { SkillsSettingsSection } from "../skill-registry/settings";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useState, type ComponentType, type ReactNode } from "react";
import {
  SettingsScopeProvider,
  useSettingsScope,
} from "~/components/settings/SettingsScopeContext";
import { SETTINGS_DEVICE_ONLY_PATHS } from "~/components/settings/SettingsScopeSentence";
import type { SettingsScopeSearch } from "~/components/settings/settingsScope";
import {
  selectEnvironmentAxis,
  settingsScopeEnvironmentLabel,
} from "~/components/settings/settingsScopeAxis";
import {
  SettingsPageContainer,
  useSettingsSearchTarget,
  useSettingsSearchTargetId,
} from "~/components/settings/settingsLayout";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger,
} from "~/components/ui/menu";
import { useEnvironments, type EnvironmentPresentation } from "~/state/environments";
import { AppleBuildToolingSettingsSection } from "../apple-build-tooling/settings";
import { CodeGraphSettingsSection } from "../code-graph/settings";
import { DeviceQaSettingsSection } from "../device-qa/settings";
import { UpstreamSupervisorSettingsSection } from "../upstream-supervisor/SettingsSection";
import { MiniOffloadSettingsSection } from "../mini-offload/settings";
import { ModelPreviewSettingsSection } from "../model-preview-3d/SettingsSection";
import { PanelPickerSettingsSection } from "../panel-picker/settings";
import { PcbPreviewSettingsSection } from "../pcb-preview/settings";
import { PreviewLinksSettingsSection } from "../preview-links/settings";
import { ProjectLifecycleSettingsSection } from "../project-lifecycle/SettingsSection";
import { ProfileSettingsSection } from "../project-profiles/ProfileSettingsSection";
import { VaultAccessSettingsSection } from "../vault/AccessSettingsSection";
import { VaultBrokerSettingsSection } from "../vault/BrokerSettingsSection";
import { VaultGitHubSettingsSection } from "../vault/GitHubSettingsSection";
import { VaultHealthSettingsSection } from "../vault/HealthSettingsSection";
import { VaultMigrationInventorySettingsSection } from "../vault/MigrationInventorySettingsSection";
import { VaultMigrationSettingsSection } from "../vault/MigrationSettingsSection";
import { VaultPasswordSettingsSection } from "../vault/PasswordGenerator";
import { VaultProfileSettingsSection } from "../vault/ProfileSettingsSection";
import { VaultSettingsSection } from "../vault/SettingsSection";
import { foldsComputerVault } from "@t3tools/client-runtime/fork";
import { AccountVault, useAccountVault } from "../vault/AccountVault";
import { VaultTestAccountSettingsSection } from "../vault/TestAccountSettingsSection";
import {
  FORK_SETTINGS_SECTIONS,
  type ForkSettingsHome,
  type ForkSettingsSection,
  type ForkSettingsTopicId,
} from "./registry";

const TOPIC_COMPONENTS: Readonly<Record<ForkSettingsTopicId, ComponentType>> = {
  "skill-registry": SkillsSettingsSection,
  "project-profiles": ProfileSettingsSection,
  "project-lifecycle": ProjectLifecycleSettingsSection,
  "mini-offload": MiniOffloadSettingsSection,
  "upstream-supervisor": UpstreamSupervisorSettingsSection,
  "apple-build-tooling": AppleBuildToolingSettingsSection,
  "device-qa": DeviceQaSettingsSection,
  "preview-links": PreviewLinksSettingsSection,
  "panel-picker": PanelPickerSettingsSection,
  "code-graph": CodeGraphSettingsSection,
  "pcb-preview": PcbPreviewSettingsSection,
  "model-preview-3d": ModelPreviewSettingsSection,
  vault: VaultSettingsSection,
  "vault-github": VaultGitHubSettingsSection,
  "vault-profiles": VaultProfileSettingsSection,
  "vault-access": VaultAccessSettingsSection,
  "vault-test-accounts": VaultTestAccountSettingsSection,
  "vault-passwords": VaultPasswordSettingsSection,
  "vault-brokers": VaultBrokerSettingsSection,
  "vault-health": VaultHealthSettingsSection,
  "vault-migration": VaultMigrationSettingsSection,
  "vault-migration-inventory": VaultMigrationInventorySettingsSection,
};

const topicsOn = (page: ForkSettingsHome) =>
  FORK_SETTINGS_SECTIONS.filter((topic) => topic.home === page);

const targetIdOf = (topic: ForkSettingsSection) => `loom-${topic.id}`;

export function VaultSettingsPage() {
  const { authority, state, access } = useAccountVault();
  const { environment } = useSettingsScope();
  const topics = topicsOn("/settings/vault");
  const advanced = topics.filter((topic) => topic.advanced);
  const elsewhere = authority.authorityId !== environment?.environmentId;
  // A device whose Library session lacks Vault access keeps the computer's Vault in view.
  if (foldsComputerVault({ elsewhere, state, access }))
    return (
      <SettingsPageContainer scopePresentation="computer">
        <AccountVault />
        <AdvancedTopics topics={topics} title="This computer’s existing Vault" />
      </SettingsPageContainer>
    );
  return (
    <SettingsPageContainer scopePresentation="computer">
      {access === "denied" ? <AccountVault /> : null}
      {topics
        .filter((topic) => !topic.advanced)
        .map((topic) => (
          <ForkSettingsTopic key={topic.id} topic={topic} />
        ))}
      {advanced.length > 0 ? <AdvancedTopics topics={advanced} /> : null}
    </SettingsPageContainer>
  );
}

// Upstream's AdvancedSettings folds rows inside a group; whole topics fold like an outside-header section.
function AdvancedTopics({
  topics,
  title = "Advanced",
}: {
  topics: readonly ForkSettingsSection[];
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const searchTargetId = useSettingsSearchTargetId();
  const [seenSearchTargetId, setSeenSearchTargetId] = useState<string | null>(null);
  if (seenSearchTargetId !== searchTargetId) {
    setSeenSearchTargetId(searchTargetId);
    if (topics.some((topic) => targetIdOf(topic) === searchTargetId)) setOpen(true);
  }
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="space-y-6">
        <h2 className="flex min-h-7 items-center px-3 sm:px-4">
          <CollapsibleTrigger className="group flex min-h-7 items-center gap-2 rounded-md text-sm font-normal text-foreground/70 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            {title}
            <ChevronRightIcon
              aria-hidden
              className="size-4 shrink-0 transition-transform duration-150 group-data-panel-open:rotate-90 motion-reduce:transition-none"
            />
          </CollapsibleTrigger>
        </h2>
        <CollapsiblePanel>
          <div className="flex min-w-0 flex-col gap-8">
            {topics.map((topic) => (
              <ForkSettingsTopic key={topic.id} topic={topic} />
            ))}
          </div>
        </CollapsiblePanel>
      </div>
    </Collapsible>
  );
}

export function ToolsSettingsPage() {
  return (
    <SettingsPageContainer scopePresentation="computer">
      {topicsOn("/settings/tools").map((topic) => (
        <ForkSettingsTopic key={topic.id} topic={topic} />
      ))}
    </SettingsPageContainer>
  );
}

export function ForkSettingsTopics({
  page,
  topics,
}: {
  page: ForkSettingsHome;
  topics?: readonly ForkSettingsTopicId[];
}) {
  return (
    <>
      {topicsOn(page)
        .filter((topic) => !topics || topics.includes(topic.id))
        .map((topic) =>
          topic.scope === "computer" || topic.scope === "mixed" ? (
            <ComputerScopedTopic key={topic.id} topic={topic} />
          ) : (
            <ForkSettingsTopic key={topic.id} topic={topic} />
          ),
        )}
    </>
  );
}

/** Pages without a scope picker never show a project, so their topics target a computer alone. */
export function forkTopicScope(search: SettingsScopeSearch, pageShowsScope: boolean) {
  return {
    search: pageShowsScope ? search : search.machine ? { machine: search.machine } : {},
    pick: (machine: string): SettingsScopeSearch =>
      pageShowsScope ? selectEnvironmentAxis(search, machine) : { machine },
  };
}

// Upstream pages may target several computers; a fork topic writes to exactly one of them.
function ComputerScopedTopic({ topic }: { topic: ForkSettingsSection }) {
  const outer = useSettingsScope();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { environments } = useEnvironments();
  const pageShowsScope = !SETTINGS_DEVICE_ONLY_PATHS.has(pathname);
  const scope = forkTopicScope(outer.search, pageShowsScope);
  const choices = pageShowsScope ? outer.environments : environments;
  return (
    <SettingsScopeProvider singleEnvironment search={scope.search} onChange={outer.selectScope}>
      <ForkSettingsTopic
        topic={topic}
        scopeLine={
          choices.length > 1 ? (
            <TopicComputerLine topic={topic} choices={choices} pick={scope.pick} />
          ) : null
        }
      />
    </SettingsScopeProvider>
  );
}

function TopicComputerLine({
  topic,
  choices,
  pick,
}: {
  topic: ForkSettingsSection;
  choices: readonly EnvironmentPresentation[];
  pick: (machine: string) => SettingsScopeSearch;
}) {
  const { environment, environments } = useSettingsScope();
  const pathname = useLocation({ select: (location) => location.pathname });
  const navigate = useNavigate();
  const current = environment ?? environments[0] ?? null;
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
      <span>
        {["upstream-supervisor", "mini-offload"].includes(topic.id) ? "Computer" : "Applies to"}
      </span>
      <Menu>
        <MenuTrigger
          aria-label={`Computer for ${topic.title}`}
          render={<Button variant="ghost-muted" size="xs" />}
          className="min-w-0 max-w-72"
        >
          <span className="min-w-0 truncate">
            {current ? settingsScopeEnvironmentLabel(current, choices) : "No connected computer"}
          </span>
          <ChevronDownIcon aria-hidden className="size-3.5 shrink-0 opacity-70" />
        </MenuTrigger>
        <MenuPopup align="start">
          <MenuRadioGroup
            value={current?.environmentId ?? ""}
            onValueChange={(machine) => {
              if (typeof machine !== "string") return;
              const next = pick(machine);
              void navigate({
                to: pathname,
                // Every axis is explicit so scope retention cannot restore a cleared one.
                search: (previous) => ({
                  ...previous,
                  project: next.project,
                  machine: next.machine,
                  checkout: next.checkout,
                }),
                hash: targetIdOf(topic),
                state: { settingsTargetHighlight: false },
                resetScroll: false,
              });
            }}
          >
            {choices.map((choice) => (
              <MenuRadioItem key={choice.environmentId} value={choice.environmentId} closeOnClick>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">
                    {settingsScopeEnvironmentLabel(choice, choices)}
                  </span>
                  {choice.connection.phase !== "connected" ? (
                    <span className="shrink-0 text-xs text-muted-foreground">Offline</span>
                  ) : null}
                  <MenuRadioItemIndicator />
                </span>
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuPopup>
      </Menu>
      {!["upstream-supervisor", "mini-offload"].includes(topic.id) ? <span>only.</span> : null}
    </p>
  );
}

function ForkSettingsTopic({
  topic,
  scopeLine,
}: {
  topic: ForkSettingsSection;
  scopeLine?: ReactNode;
}) {
  const targetId = targetIdOf(topic);
  const targetRef = useSettingsSearchTarget<HTMLElement>(targetId);
  const Component = TOPIC_COMPONENTS[topic.id];
  const pageHeading = topic.id === "upstream-supervisor" || topic.id === "mini-offload";
  return (
    <section
      id={targetId}
      ref={targetRef}
      tabIndex={-1}
      aria-labelledby={`${targetId}-title`}
      className="min-w-0 space-y-2.5 outline-none"
    >
      <header data-settings-scroll-target className={pageHeading ? "" : "space-y-1 px-3 sm:px-4"}>
        <div className={pageHeading ? "" : "flex min-h-7 min-w-0 flex-wrap items-center gap-2"}>
          <h2
            id={`${targetId}-title`}
            className={
              pageHeading
                ? "sr-only"
                : "flex min-h-7 items-center text-base font-semibold text-foreground"
            }
          >
            {topic.title}
          </h2>
          {topic.scope === "device" ? <Badge variant="secondary">This device</Badge> : null}
        </div>
        {!pageHeading ? (
          <p className="max-w-2xl text-xs leading-normal text-balance text-muted-foreground">
            {topic.description}
            {topic.scope === "mixed"
              ? " Preview preferences stay on this device. Tool configuration applies to the selected computer."
              : null}
          </p>
        ) : null}
        {scopeLine}
      </header>
      <div className="min-w-0 wrap-anywhere">
        <Component />
      </div>
    </section>
  );
}
