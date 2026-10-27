// fork: tailnet-ownership
import type { DesktopTailscaleServeStatus, DesktopWslState } from "@t3tools/contracts";
import { createAdvertisedEndpoint } from "@t3tools/shared/advertisedEndpoint";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  applyWslEnableSelection,
  // fork: tailnet-ownership
  describeTailscaleServeRow,
  localBackendPort,
  selectQrEndpointOption,
  tailscaleServePortProblem, // fork: tailnet-ownership
  togglePairingScopeSelection,
} from "./ConnectionsSettings.logic";

describe("togglePairingScopeSelection", () => {
  it.each([
    {
      label: "adds terminal:read when terminal:operate is selected",
      current: ["orchestration:read"],
      scope: "terminal:operate",
      checked: true,
      expected: ["orchestration:read", "terminal:operate", "terminal:read"],
    },
    {
      label: "drops terminal:operate when terminal:read is cleared",
      current: ["terminal:read", "terminal:operate", "relay:read"],
      scope: "terminal:read",
      checked: false,
      expected: ["relay:read"],
    },
    {
      label: "keeps terminal:read when terminal:operate is cleared",
      current: ["terminal:read", "terminal:operate"],
      scope: "terminal:operate",
      checked: false,
      expected: ["terminal:read"],
    },
    {
      label: "toggles unrelated scopes on their own",
      current: ["terminal:read"],
      scope: "filesystem:read",
      checked: true,
      expected: ["terminal:read", "filesystem:read"],
    },
  ] as const)("$label", ({ current, scope, checked, expected }) => {
    expect(togglePairingScopeSelection(current, scope, checked)).toEqual(expected);
  });
});

const baseWslState: DesktopWslState = {
  enabled: false,
  distro: null,
  available: true,
  wslOnly: true,
  distros: [],
  preflightError: null,
};

describe("applyWslEnableSelection", () => {
  it("clears WSL-only and updates the distro before enabling both backends", async () => {
    const calls: Array<string> = [];
    let persistedWslOnly = true;
    let persistedDistro: string | null = "Ubuntu";
    const setWslDistro = vi.fn(async (distro: string | null) => {
      calls.push(`setWslDistro:${distro ?? "default"}`);
      persistedDistro = distro;
      return { ...baseWslState, distro, wslOnly: persistedWslOnly };
    });
    const setWslBackendEnabled = vi.fn(async (enabled: boolean) => {
      calls.push(`setWslBackendEnabled:${enabled}`);
      return {
        ...baseWslState,
        enabled,
        distro: persistedDistro,
        wslOnly: persistedWslOnly,
      };
    });
    const setWslOnly = vi.fn(async (enabled: boolean) => {
      calls.push(`setWslOnly:${enabled}`);
      persistedWslOnly = enabled;
      return { ...baseWslState, distro: persistedDistro, wslOnly: enabled };
    });

    const state = await applyWslEnableSelection({
      bridge: { setWslDistro, setWslBackendEnabled, setWslOnly },
      mode: "both",
      nextDistro: "Debian",
      persistedDistro: "Ubuntu",
    });

    expect(calls).toEqual(["setWslOnly:false", "setWslDistro:Debian", "setWslBackendEnabled:true"]);
    expect(state).toMatchObject({ enabled: true, distro: "Debian", wslOnly: false });
  });
});

describe("selectQrEndpointOption", () => {
  const options = [
    {
      id: "desktop-loopback:4780",
      preferenceKey: "desktop-core:loopback:http",
      qrShareable: false,
    },
    {
      id: "tailscale-ip:http://100.84.12.7:4780",
      preferenceKey: "tailscale:ip:http",
      qrShareable: true,
    },
    {
      id: "tailscale-ip:http://100.84.12.8:4780",
      preferenceKey: "tailscale:ip:http",
      qrShareable: true,
    },
    {
      id: "desktop-lan:http://192.168.1.42:4780",
      preferenceKey: "desktop-core:lan:http",
      qrShareable: true,
    },
  ];

  it("resolves an explicit selection by unique endpoint id, not the shared preference key", () => {
    expect(selectQrEndpointOption(options, "tailscale-ip:http://100.84.12.8:4780", null)?.id).toBe(
      "tailscale-ip:http://100.84.12.8:4780",
    );
  });

  it("skips non-QR-shareable options in the fallback so the panel never opens on loopback", () => {
    expect(selectQrEndpointOption(options, "tailscale-ip:gone", "nope")?.id).toBe(
      "tailscale-ip:http://100.84.12.7:4780",
    );
  });
});

// fork: tailnet-ownership
const TAILSCALE_PROVIDER = {
  id: "tailscale",
  label: "Tailscale",
  kind: "private-network",
  isAddon: true,
} as const;

const servedEndpoint = (status: "available" | "unavailable") =>
  createAdvertisedEndpoint({
    provider: TAILSCALE_PROVIDER,
    source: "desktop-addon",
    id: "tailscale-magicdns:https://desktop.tail.ts.net",
    label: "Tailscale HTTPS",
    httpBaseUrl: "https://desktop.tail.ts.net",
    reachability: "private-network",
    status,
  });

const serveStatus = (
  state: DesktopTailscaleServeStatus["state"],
  holder: string | null = null,
): DesktopTailscaleServeStatus => ({
  state,
  magicDnsName: "desktop.tail.ts.net",
  holder,
  heldPorts: [],
});

describe("describeTailscaleServeRow", () => {
  const enabled = (tailscaleServe: DesktopTailscaleServeStatus | null) => ({
    tailscaleServeEnabled: true,
    tailscaleServePort: 443,
    tailscaleServe,
  });

  it("offers setup while Serve is off, including in local-only mode", () => {
    expect(
      describeTailscaleServeRow({
        state: { tailscaleServeEnabled: false, tailscaleServePort: 443, tailscaleServe: null },
        endpoint: null,
      }),
    ).toEqual({
      text: "Reach this computer at a private HTTPS address on your tailnet with Tailscale Serve.",
      needsAttention: false,
    });
  });

  it("shows the address once Serve answers as this computer", () => {
    expect(
      describeTailscaleServeRow({
        state: enabled(serveStatus("configured")),
        endpoint: servedEndpoint("available"),
      }),
    ).toEqual({ text: "https://desktop.tail.ts.net/", needsAttention: false });
  });

  it.each([
    [serveStatus("port-held", "http://127.0.0.1:8397"), "already serves http://127.0.0.1:8397"],
    [serveStatus("tcp-forward", "127.0.0.1:8321"), "forwards to 127.0.0.1:8321"],
    [serveStatus("not-configured"), "not serving yet"],
    [serveStatus("https-disabled"), "HTTPS certificates are off"],
    [serveStatus("cli-unavailable"), "not installed"],
  ])("asks for attention, in plain words, when Serve is on but %#", (status, text) => {
    const row = describeTailscaleServeRow({
      state: enabled(status),
      endpoint: servedEndpoint("unavailable"),
    });
    expect(row.needsAttention).toBe(true);
    expect(row.text).toContain(text);
  });
});

describe("tailscaleServePortProblem", () => {
  const heldPorts = [{ port: 443, holder: "http://127.0.0.1:8397" }];

  it.each([
    ["0", "Enter a port from 1 to 65535."],
    ["8443.5", "Enter a port from 1 to 65535."],
    ["3773", "Port 3773 is the port Loom's backend listens on. Choose another port."],
    ["443", "Port 443 already serves http://127.0.0.1:8397. Choose another port."],
    ["8443", null],
  ])("port %s", (portInput, problem) => {
    expect(tailscaleServePortProblem({ portInput, backendPort: 3773, heldPorts })).toBe(problem);
  });

  it("reads the backend port from the loopback endpoint", () => {
    expect(
      localBackendPort([
        servedEndpoint("available"),
        createAdvertisedEndpoint({
          provider: { id: "desktop-core", label: "Desktop", kind: "core", isAddon: false },
          source: "desktop-core",
          id: "desktop-loopback:3773",
          label: "This machine",
          httpBaseUrl: "http://127.0.0.1:3773",
          reachability: "loopback",
        }),
      ]),
    ).toBe(3773);
  });
});
