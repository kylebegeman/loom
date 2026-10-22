import { Activity, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { SearchIcon, XIcon } from "lucide-react";
import {
  SettingsPageContainer,
  useSettingsSearchTarget,
} from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { InputGroup, InputGroupAddon } from "~/components/ui/input-group";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { cn } from "~/lib/utils";
import {
  filterLoomSettingsSections,
  LOOM_SETTINGS_GROUPS,
  resolveLoomSettingsSection,
} from "./navigation";
import { LoomSettingsContent } from "./parts";
import { FORK_SETTINGS_SECTIONS, type ForkSettingsSection } from "./registry";

export function LoomSettingsPage() {
  const search = useSearch({ from: "/settings/loom" });
  const navigate = useNavigate();
  const selected = resolveLoomSettingsSection(FORK_SETTINGS_SECTIONS, search.section);
  const [query, setQuery] = useState("");
  const [visited, setVisited] = useState<readonly string[]>([selected.id]);
  // Retain unfinished forms across topic changes. Hidden topics pause their effects.
  if (!visited.includes(selected.id)) setVisited([...visited, selected.id]);
  const matching = filterLoomSettingsSections(FORK_SETTINGS_SECTIONS, query);
  const groups = LOOM_SETTINGS_GROUPS.map((group) => ({
    ...group,
    sections: matching.filter((section) => section.group === group.id),
  })).filter((group) => group.sections.length > 0);
  const selectSection = (section: string) => {
    setQuery("");
    void navigate({
      to: "/settings/loom",
      search: (current) => ({ ...current, section }),
      hash: `loom-${section}`,
      state: { settingsTargetHighlight: false },
      resetScroll: false,
    });
  };

  return (
    <SettingsPageContainer width="expanded" className="@container/loom-settings">
      <div className="flex min-w-0 flex-col gap-4 @min-[40rem]/loom-settings:flex-row @min-[40rem]/loom-settings:items-end @min-[40rem]/loom-settings:justify-between">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Loom settings</h1>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            Manage tools, files, and development access.
          </p>
        </div>
        <div className="w-full @min-[40rem]/loom-settings:w-72">
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon aria-hidden className="size-4" />
            </InputGroupAddon>
            <Input
              type="search"
              aria-label="Find Loom settings"
              placeholder="Find a setting…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query ? (
              <InputGroupAddon align="inline-end">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Clear settings search"
                  onClick={() => setQuery("")}
                >
                  <XIcon aria-hidden />
                </Button>
              </InputGroupAddon>
            ) : null}
          </InputGroup>
        </div>
      </div>
      <div className="grid min-w-0 items-start gap-6 @min-[52rem]/loom-settings:grid-cols-[12.5rem_minmax(0,1fr)] @min-[52rem]/loom-settings:gap-8">
        <nav
          aria-label="Loom settings topics"
          className="min-w-0 @min-[52rem]/loom-settings:sticky @min-[52rem]/loom-settings:top-4 @min-[52rem]/loom-settings:max-h-[calc(100dvh-var(--workspace-topbar-height)-2rem)] @min-[52rem]/loom-settings:overflow-y-auto @min-[52rem]/loom-settings:overscroll-contain"
        >
          <div className="@min-[52rem]/loom-settings:hidden">
            <Select
              value={selected.id}
              onValueChange={(value) => {
                if (value) selectSection(value);
              }}
              items={FORK_SETTINGS_SECTIONS.map((section) => ({
                value: section.id,
                label: section.title,
              }))}
            >
              <SelectTrigger aria-label="Settings topic">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {LOOM_SETTINGS_GROUPS.map((group) => (
                  <SelectGroup key={group.id}>
                    <SelectGroupLabel>{group.title}</SelectGroupLabel>
                    {FORK_SETTINGS_SECTIONS.filter((section) => section.group === group.id).map(
                      (section) => (
                        <SelectItem key={section.id} value={section.id}>
                          {section.title}
                        </SelectItem>
                      ),
                    )}
                  </SelectGroup>
                ))}
              </SelectPopup>
            </Select>
          </div>
          <div
            className={cn(
              "space-y-6",
              query
                ? "mt-4 @min-[52rem]/loom-settings:mt-0"
                : "hidden @min-[52rem]/loom-settings:block",
            )}
          >
            {groups.map((group) => (
              <div key={group.id} className="space-y-1.5">
                <h2 className="px-3 text-xs font-medium text-muted-foreground">{group.title}</h2>
                <ul className="space-y-0.5">
                  {group.sections.map((section) => (
                    <li key={section.id}>
                      <Link
                        to="/settings/loom"
                        search={(current) => ({ ...current, section: section.id })}
                        hash={`loom-${section.id}`}
                        state={{ settingsTargetHighlight: false }}
                        resetScroll={false}
                        onClick={() => setQuery("")}
                        aria-current={selected.id === section.id ? "page" : undefined}
                        className={cn(
                          "block rounded-lg px-3 py-2 text-sm leading-snug outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                          selected.id === section.id
                            ? "bg-muted font-medium text-foreground"
                            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                        )}
                      >
                        <span>{section.title}</span>
                        {query.trim() ? (
                          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                            {section.description}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {matching.length === 0 ? (
            <div role="status" className="mt-3 space-y-3 px-3 text-sm text-muted-foreground">
              <p>No settings match “{query}”. Try a tool, connection, or setting name.</p>
              <Button variant="outline" size="sm" onClick={() => setQuery("")}>
                Clear search
              </Button>
            </div>
          ) : null}
        </nav>
        <div className="min-w-0">
          {FORK_SETTINGS_SECTIONS.filter((section) => visited.includes(section.id)).map(
            (section) => (
              <Activity key={section.id} mode={section.id === selected.id ? "visible" : "hidden"}>
                <LoomSettingsPane section={section} />
              </Activity>
            ),
          )}
        </div>
      </div>
    </SettingsPageContainer>
  );
}

function LoomSettingsPane({ section }: { section: ForkSettingsSection }) {
  const { id, title, description, layout, Component } = section;
  const targetId = `loom-${id}`;
  const targetRef = useSettingsSearchTarget<HTMLElement>(targetId);
  return (
    <section
      id={targetId}
      ref={targetRef}
      tabIndex={-1}
      aria-labelledby={`${targetId}-title`}
      className="min-w-0 outline-none"
    >
      <header data-settings-scroll-target className="mb-5 space-y-1.5 px-1">
        <h2 id={`${targetId}-title`} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">{description}</p>
      </header>
      <div className="min-w-0 rounded-xl border border-border/60 bg-card/40 wrap-anywhere">
        {layout === "rows" ? (
          <Component />
        ) : (
          <LoomSettingsContent>
            <Component />
          </LoomSettingsContent>
        )}
      </div>
    </section>
  );
}
