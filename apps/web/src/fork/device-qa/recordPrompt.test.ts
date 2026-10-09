import { describe, expect, it } from "vite-plus/test";
import { recordPrompt, recordPromptProblem } from "./recordPrompt";

const device = { name: "iPhone 17", platform: "ios", deviceId: "SIM-1" };

describe("recordPrompt", () => {
  it("names the flow file under the chosen folder and the device to record on", () => {
    const prompt = recordPrompt({
      name: "pay",
      folder: "/checkout//eu/",
      description: "Open the cart and pay with the saved card.",
      device,
    });
    expect(prompt).toContain('named "pay" in .argent/flows/checkout/eu/pay.yaml on iPhone 17');
    expect(prompt).toContain(
      "(ios, id SIM-1). Path: Open the cart and pay with the saved card. Use argent",
    );
    expect(recordPrompt({ name: "login", folder: "", description: "Sign in", device })).toContain(
      ".argent/flows/login.yaml",
    );
  });

  it("refuses names and folders argent cannot load", () => {
    expect(recordPromptProblem({ name: "", folder: "" })).toBe("Name the flow.");
    expect(recordPromptProblem({ name: "check out", folder: "" })).toMatch(/flow name/);
    expect(recordPromptProblem({ name: "pay", folder: "../secrets" })).toMatch(/folder names/);
    expect(recordPromptProblem({ name: "pay", folder: "checkout/eu" })).toBeNull();
  });
});
