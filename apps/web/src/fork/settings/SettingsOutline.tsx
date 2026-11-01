import { useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon, ListIcon } from "lucide-react";
import { useState, type RefObject } from "react";
import { revealSettingsSearchTarget } from "~/components/settings/settingsSearch";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";

export function LoomSettingsOutline({
  contentRef,
}: {
  contentRef: RefObject<HTMLDivElement | null>;
}) {
  const navigate = useNavigate();
  const [sections, setSections] = useState<readonly { id: string; title: string }[]>([]);
  const [jumping, setJumping] = useState(false);

  return (
    <div className="shrink-0 border-b border-border/60 px-5 py-1.5 sm:px-6">
      <Menu
        onOpenChange={(open) => {
          if (!open) return;
          setJumping(false);
          // Read on open so async and scoped pages contribute their current sections.
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
          On this page
          <ChevronDownIcon aria-hidden />
        </MenuTrigger>
        <MenuPopup align="start" finalFocus={jumping ? false : undefined}>
          {sections.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">No sections on this page.</p>
          ) : (
            sections.map((section) => (
              <MenuItem
                key={section.id}
                onClick={() => {
                  setJumping(true);
                  revealSettingsSearchTarget(section.id);
                  void navigate({
                    hash: section.id,
                    replace: true,
                    resetScroll: false,
                    hashScrollIntoView: false,
                    state: { settingsTargetHighlight: true },
                  });
                }}
              >
                {section.title}
              </MenuItem>
            ))
          )}
        </MenuPopup>
      </Menu>
    </div>
  );
}
