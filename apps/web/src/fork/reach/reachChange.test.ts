import { REACH_CHANGE_ELSEWHERE_TEXT } from "@t3tools/client-runtime/fork";
import {
  AuthRelayWriteScope,
  EnvironmentAuthorizationError,
  authScopeRequiredResponse,
} from "@t3tools/contracts";
import { ReachError } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import { describe, expect, it } from "vite-plus/test";
import { confirmCopy, connectedThroughAddress, reachChangeFailureText } from "./reachChange";

const busy = Cause.fail(new ReachError({ reason: "busy" }));
const denied = Cause.fail(
  new EnvironmentAuthorizationError({
    ...authScopeRequiredResponse(AuthRelayWriteScope),
    message: "This connection requires relay:write.",
  }),
);
const dropped = Cause.fail({ _tag: "EnvironmentRpcUnavailableError", message: "closed" });

describe("reachChangeFailureText", () => {
  it("reports every failure of a change that keeps this device's route", () => {
    expect(reachChangeFailureText(busy, false)).toBe(new ReachError({ reason: "busy" }).message);
    expect(reachChangeFailureText(denied, false)).toBe(REACH_CHANGE_ELSEWHERE_TEXT);
    expect(reachChangeFailureText(dropped, false)).toBe("Connect this computer to change reach.");
    expect(reachChangeFailureText(Cause.die(new Error("boom")), false)).toBe(
      "Loom could not change reach on this computer.",
    );
  });

  it("treats a reply lost with a confirmed route drop as the expected outcome", () => {
    expect(reachChangeFailureText(dropped, true)).toBeNull();
    expect(reachChangeFailureText(Cause.die(new Error("socket closed")), true)).toBeNull();
  });

  it("still reports a refusal the computer sent before the route dropped", () => {
    expect(reachChangeFailureText(busy, true)).toBe(new ReachError({ reason: "busy" }).message);
    expect(reachChangeFailureText(denied, true)).toBe(REACH_CHANGE_ELSEWHERE_TEXT);
  });

  it("stays quiet when the user interrupted the change", () => {
    expect(reachChangeFailureText(Cause.interrupt(), false)).toBeNull();
  });
});

describe("connectedThroughAddress", () => {
  it("compares origins, so a path or a trailing slash does not matter", () => {
    const address = "https://studio-loom.reach.example/";
    expect(connectedThroughAddress("https://studio-loom.reach.example", address)).toBe(true);
    expect(connectedThroughAddress("https://studio-loom.reach.example/ws?x=1", address)).toBe(true);
    expect(connectedThroughAddress("https://studio.tailnet.ts.net", address)).toBe(false);
    expect(connectedThroughAddress("http://studio-loom.reach.example", address)).toBe(false);
  });

  it("is false while either address is unknown or unreadable", () => {
    expect(connectedThroughAddress(null, "https://studio-loom.reach.example/")).toBe(false);
    expect(connectedThroughAddress("https://studio-loom.reach.example", null)).toBe(false);
    expect(connectedThroughAddress("not a url", "https://studio-loom.reach.example/")).toBe(false);
  });
});

describe("confirmCopy", () => {
  it("titles the question and keeps the rest as the description", () => {
    expect(confirmCopy("Retire studio-loom.reach.example? Loom deletes its tunnel.")).toEqual({
      title: "Retire studio-loom.reach.example?",
      description: "Loom deletes its tunnel.",
    });
    expect(confirmCopy("Retire studio?")).toEqual({ title: "Retire studio?", description: null });
    expect(confirmCopy("No question here.")).toEqual({
      title: "No question here.",
      description: null,
    });
  });
});
