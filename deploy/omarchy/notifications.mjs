import { connectionCommand } from "./connections.mjs";
import { paths, finderChoice } from "./loom-os.mjs";

/** The desktop stays the sole banner service; apps own events, privacy and record actions. */
export async function notificationStatus(env, dependencies = {}) {
  const command = dependencies.command ?? connectionCommand;
  const reply = await command("omarchy-shell", ["notifications", "dndState"], env);
  const mode = reply.exit === 0 ? reply.stdout.trim() : "unavailable";
  return {
    native: ["on", "off"].includes(mode) ? mode : "unavailable",
    focus: mode === "on",
    delivery: "app-owned",
    readOnly: true,
    detail:
      mode === "on"
        ? "Native Do Not Disturb is on. Ordinary app banners stay quiet; each app keeps its own history."
        : mode === "off"
          ? "Native banners are allowed. App permissions, privacy and quiet schedules still apply."
          : "The native notification service is unavailable. App history and notification settings remain available.",
  };
}
export async function setNotificationFocus(enabled, env, dependencies = {}) {
  if (typeof enabled !== "boolean") throw Error("Choose focus on or off.");
  const command = dependencies.command ?? connectionCommand;
  const status = await notificationStatus(env, dependencies);
  if (status.native === "unavailable") throw Error(status.detail);
  const result = await command(
    "omarchy-shell",
    ["notifications", "setDnd", enabled ? "on" : "off"],
    env,
  );
  if (result.exit !== 0 || result.stdout.trim() !== (enabled ? "on" : "off"))
    throw Error(
      "The desktop did not confirm its notification setting. Check native Do Not Disturb.",
    );
  return notificationStatus(env, dependencies);
}
export async function notificationHistory(env, dependencies = {}) {
  const result = await (dependencies.command ?? connectionCommand)(
    "omarchy-shell",
    ["notifications", "showHistory"],
    env,
  );
  if (result.exit !== 0) throw Error("Native notification history is unavailable.");
}
export function formatNotificationStatus(status) {
  return [
    "Notifications",
    "",
    status.detail,
    "",
    "Office: reminders, events, mail and approvals use its current source permissions, delivery rules and installation settings.",
    "Atlas: background work alerts use its open client, with private previews by default.",
    "Loom: thread alerts open the owning thread for review; an alert never grants approval.",
    "",
    "Focus uses the desktop's native Do Not Disturb. It does not change app permissions, sounds, schedules or history.",
  ].join("\n");
}
export async function nativeNotifications(config, env, dependencies = {}) {
  const choose = dependencies.choose ?? ((args) => finderChoice(args, env));
  const show = dependencies.show ?? console.log;
  const open =
    dependencies.open ??
    (async (app) => {
      const result = await (dependencies.command ?? connectionCommand)(
        paths(env).bin,
        ["open", app],
        env,
      );
      if (result.exit !== 0)
        throw Error("The owning app did not open. Check connections and retry.");
    });
  for (;;) {
    const status = await notificationStatus(env, dependencies);
    show(formatNotificationStatus(status));
    const choices = [
      ...(status.native === "unavailable"
        ? []
        : [
            status.focus ? "Resume native banners" : "Focus: quiet native banners",
            "Native notification history",
          ]),
      "Office alerts and delivery rules",
      ...(config.atlasUrl ? ["Atlas background alerts"] : []),
      "Loom thread notifications",
      "Done",
    ];
    const action = await choose(["choose", "--header", "Notifications", ...choices]);
    if (!action || action === "Done") return;
    if (!choices.includes(action)) throw Error("Unknown notification action.");
    if (action === "Focus: quiet native banners" || action === "Resume native banners")
      await setNotificationFocus(action.startsWith("Focus:"), env, dependencies);
    else if (action === "Native notification history") await notificationHistory(env, dependencies);
    else {
      const app = action.startsWith("Office")
        ? "office"
        : action.startsWith("Atlas")
          ? "atlas"
          : "loom";
      show(
        app === "office"
          ? "Open the Office bell, then All alerts for privacy, quiet hours and delivery settings."
          : app === "atlas"
            ? "Open the Atlas bell, then Desktop alerts. Permission is requested only from its Enable button."
            : "Open Loom Settings, then General to choose thread alerts and title previews.",
      );
      await open(app);
    }
  }
}
