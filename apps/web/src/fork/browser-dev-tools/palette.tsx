import { SquareTerminalIcon } from "lucide-react";
import type { ForkCommandPaletteSource } from "../commandPalette/registry";
import { openDevEnvironment } from "./state";
export const devEnvironmentPaletteSource: ForkCommandPaletteSource = {
  id: "browser-dev-tools",
  items: ({ activeThreadRef, loomFeatures }) =>
    activeThreadRef && loomFeatures.includes("browser-dev-tools")
      ? [
          {
            kind: "action",
            value: "action:loom:browser-dev-tools:open",
            title: "Open development tools",
            icon: <SquareTerminalIcon className="size-4" />,
            description: "Run commands, logs, Browser diagnostics, Compose and databases",
            searchTerms: [
              "dev",
              "server",
              "start",
              "stop",
              "restart",
              "logs",
              "docker",
              "compose",
              "postgres",
              "valkey",
              "console",
              "network",
              ...(loomFeatures.includes("browser-dev-tools-http")
                ? ["http", "api", "request", "response"]
                : []),
            ],
            run: async () => openDevEnvironment(activeThreadRef),
          },
        ]
      : [],
};
