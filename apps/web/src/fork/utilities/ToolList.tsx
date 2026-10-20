import { useState } from "react";

import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";
import {
  findUtilityToolMeta,
  searchUtilityTools,
  UTILITY_CATEGORIES,
  UTILITY_TOOL_META,
} from "./registry-meta";
import type { UtilityToolMeta } from "./types";

interface ToolGroup {
  readonly id: string;
  readonly label: string;
  readonly tools: ReadonlyArray<UtilityToolMeta>;
}

function groupsFor(query: string, recent: ReadonlyArray<string>): ReadonlyArray<ToolGroup> {
  if (query.trim() !== "")
    return [{ id: "results", label: "Results", tools: searchUtilityTools(query, recent) }];
  const recentTools = recent.flatMap((id) => findUtilityToolMeta(id) ?? []);
  const categories = UTILITY_CATEGORIES.map((category) => ({
    id: category.id,
    label: category.label,
    tools: UTILITY_TOOL_META.filter((tool) => tool.category === category.id),
  }));
  return recentTools.length > 0
    ? [{ id: "recent", label: "Recent", tools: recentTools }, ...categories]
    : categories;
}

export function ToolList({
  selectedId,
  recent,
  onSelect,
}: {
  readonly selectedId: string | null;
  readonly recent: ReadonlyArray<string>;
  readonly onSelect: (toolId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const groups = groupsFor(query, recent);
  const firstMatch = groups[0]?.tools[0];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="p-2">
        <Input
          size="sm"
          type="search"
          aria-label="Search utilities"
          placeholder="Search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && firstMatch) onSelect(firstMatch.id);
          }}
        />
      </div>
      <nav aria-label="Utilities" className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {groups[0]?.tools.length === 0 ? (
          <p className="px-2 text-muted-foreground text-sm">No tools match "{query.trim()}".</p>
        ) : (
          groups.map((group) => (
            <section key={group.id} aria-label={group.label} className="pb-2">
              {group.id !== "results" && (
                <h3 className="px-2 pt-1 pb-0.5 font-medium text-muted-foreground text-xs">
                  {group.label}
                </h3>
              )}
              <ul>
                {group.tools.map((tool) => (
                  <li key={tool.id}>
                    <button
                      type="button"
                      aria-current={tool.id === selectedId ? "true" : undefined}
                      className={cn(
                        "w-full truncate rounded-md px-2 py-1 text-start text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                        tool.id === selectedId && "bg-accent font-medium",
                      )}
                      onClick={() => onSelect(tool.id)}
                    >
                      {tool.label}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </nav>
    </div>
  );
}
