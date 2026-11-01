import { useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon, ListIcon } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { SettingsPageContainer } from "~/components/settings/settingsLayout";
import { revealSettingsSearchTarget } from "~/components/settings/settingsSearch";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";

export function ComputersSettingsPage({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const contentRef = useRef<HTMLDivElement>(null);
  const [sections, setSections] = useState<readonly { id: string; title: string }[]>([]);
  const [jumping, setJumping] = useState(false);
  const jumpTo = (id: string) => {
    revealSettingsSearchTarget(id);
    void navigate({
      hash: id,
      replace: true,
      resetScroll: false,
      hashScrollIntoView: false,
      state: { settingsTargetHighlight: true },
    });
  };

  return (
    <div ref={contentRef} className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 space-y-3 border-b border-border/60 px-5 py-4 sm:px-6">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Computers</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Connect computers and manage their updates and background work.
          </p>
        </div>
        <nav aria-label="Computers page sections" className="flex flex-wrap items-center gap-2">
          <Menu
            onOpenChange={(open) => {
              if (!open) return;
              setJumping(false);
              // Read on open so async and scoped sections reflect the current page.
              const elements = contentRef.current?.querySelectorAll<HTMLElement>("section[id]");
              setSections(
                Array.from(elements ?? []).flatMap((section) => {
                  const title = section
                    .querySelector("h2, [data-slot='collapsible-trigger'] > span")
                    ?.textContent?.trim();
                  return title ? [{ id: section.id, title }] : [];
                }),
              );
            }}
          >
            <MenuTrigger render={<Button variant="ghost" size="sm" />}>
              <ListIcon aria-hidden />
              Jump to section
              <ChevronDownIcon aria-hidden />
            </MenuTrigger>
            <MenuPopup align="start" finalFocus={jumping ? false : undefined}>
              {sections.length === 0 ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">Loading sections…</p>
              ) : (
                sections.map((section) => (
                  <MenuItem
                    key={section.id}
                    onClick={() => {
                      setJumping(true);
                      jumpTo(section.id);
                    }}
                  >
                    {section.title}
                  </MenuItem>
                ))
              )}
            </MenuPopup>
          </Menu>
          <Button variant="outline" size="sm" onClick={() => jumpTo("loom-upstream-supervisor")}>
            Upstream supervisor
          </Button>
        </nav>
      </header>
      <SettingsPageContainer>{children}</SettingsPageContainer>
    </div>
  );
}
