// A suspended session must not keep showing an old successful connection check.
// oxlint-disable-next-line no-unused-vars -- QML imports this function as StatusModel.view.
function view(raw, now) {
  var empty = {
    state: "offline",
    aiReady: false,
    tooltip: "Loom · connection status unavailable\nClick to check connections.",
    components: [],
  };
  try {
    var report = JSON.parse(raw);
    var stamp = Date.parse(report.generatedAt);
    if (
      report.version !== 1 ||
      !isFinite(stamp) ||
      stamp > now + 60000 ||
      now - stamp > 90000 ||
      ["ok", "attention", "offline"].indexOf(report.state) < 0 ||
      typeof report.aiReady !== "boolean" ||
      !Array.isArray(report.components) ||
      !report.components.length
    )
      return empty;
    var titles = { tailscale: "Tailscale", switchboard: "Switchboard", loom: "Loom server" };
    var labels = {
      ok: "Ready",
      warning: "Needs attention",
      error: "Unavailable",
      unknown: "Not confirmed",
    };
    var seen = {};
    var lines = [report.aiReady ? "Loom · private AI ready" : "Loom · private AI unavailable"];
    for (var i = 0; i < report.components.length; i++) {
      var part = report.components[i];
      if (!part || !titles[part.id] || !labels[part.state] || seen[part.id]) return empty;
      seen[part.id] = true;
      lines.push(titles[part.id] + ": " + labels[part.state]);
    }
    if (!seen.tailscale || !seen.switchboard) return empty;
    var gateway = report.components.find(function (part) {
      return part.id === "switchboard";
    });
    if (
      report.aiReady &&
      (gateway.state !== "ok" ||
        report.components.some(function (part) {
          return part.id === "tailscale" && part.state === "error";
        }))
    )
      return empty;
    if (
      report.state === "ok" &&
      report.components.some(function (part) {
        return part.state !== "ok";
      })
    )
      return empty;
    lines.push("Click for status and recovery.");
    return {
      state: report.state,
      aiReady: report.aiReady,
      tooltip: lines.join("\n"),
      components: report.components,
    };
    // oxlint-disable-next-line no-unused-vars -- Qt requires a catch binding; invalid reports use the safe fallback.
  } catch (error) {
    return empty;
  }
}
