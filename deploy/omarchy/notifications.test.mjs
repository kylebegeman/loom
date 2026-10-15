import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import { notificationStatus, setNotificationFocus, nativeNotifications } from "./notifications.mjs";
NodeTest.test(
  "native focus uses existing DND without altering app permissions or data",
  async () => {
    const calls = [];
    let dnd = "off";
    const command = async (file, args) => {
      calls.push({ file, args });
      if (args[1] === "setDnd") dnd = args[2];
      return { exit: 0, stdout: dnd };
    };
    NodeAssert.equal((await notificationStatus({}, { command })).readOnly, true);
    NodeAssert.equal((await setNotificationFocus(true, {}, { command })).focus, true);
    NodeAssert.equal((await setNotificationFocus(false, {}, { command })).focus, false);
    NodeAssert.ok(calls.every((c) => c.file === "omarchy-shell" && c.args[0] === "notifications"));
  },
);
NodeTest.test("missing or malformed native service never reports banners enabled", async () => {
  for (const result of [
    { exit: 1, stdout: "" },
    { exit: 0, stdout: "Function not found." },
  ]) {
    const command = async () => result;
    NodeAssert.equal((await notificationStatus({}, { command })).native, "unavailable");
    await NodeAssert.rejects(setNotificationFocus(true, {}, { command }), /unavailable/);
  }
});
NodeTest.test("failed native mutation is reported without pretending focus changed", async () => {
  const command = async (_file, args) => ({
    exit: 0,
    stdout: args[1] === "dndState" ? "off" : "unknown",
  });
  await NodeAssert.rejects(setNotificationFocus(true, {}, { command }), /did not confirm/);
});
NodeTest.test(
  "cancelled controls perform no mutation; app actions use one owning launcher",
  async () => {
    const calls = [];
    const command = async (_file, args) => {
      calls.push(args);
      return { exit: 0, stdout: "off" };
    };
    await nativeNotifications(
      { atlasUrl: "https://atlas.test" },
      {},
      { command, choose: async () => null, show() {} },
    );
    NodeAssert.ok(calls.every((args) => args[1] === "dndState"));
    const choices = [
      "Office alerts and delivery rules",
      "Atlas background alerts",
      "Loom thread notifications",
      "Done",
    ];
    const opened = [];
    await nativeNotifications(
      { atlasUrl: "https://atlas.test" },
      {},
      {
        command,
        choose: async () => choices.shift(),
        show() {},
        open: async (app) => opened.push(app),
      },
    );
    NodeAssert.deepEqual(opened, ["office", "atlas", "loom"]);
  },
);
