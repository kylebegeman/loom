function hasControls(text) {
  for (var i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) < 32 || text.charCodeAt(i) === 127) return true;
  }
  return false;
}
// QML and the focused Node fixtures share the same strict, read-only view model.
// oxlint-disable-next-line no-unused-vars -- QML imports this function.
function freshness(previous, now, minimum) {
  return now < previous || now - previous > 5000
    ? { minimum: now, refresh: true }
    : { minimum: minimum, refresh: false };
}
// oxlint-disable-next-line no-unused-vars -- QML imports this function as StatusModel.view.
function view(raw, now, minimum) {
  var empty = {
    state: "offline",
    aiReady: false,
    tooltip: "Loom · status unavailable\nOpen What works now to check again.",
    components: [],
    apps: [],
  };
  try {
    var report = JSON.parse(raw);
    var stamp = Date.parse(report.generatedAt);
    if (
      [1, 2].indexOf(report.version) < 0 ||
      !isFinite(stamp) ||
      stamp > now + 60000 ||
      now - stamp > 90000 ||
      (minimum && stamp < minimum) ||
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
    var lines = [
      report.version === 1
        ? report.aiReady
          ? "Loom · private AI ready"
          : "Loom · private AI unavailable"
        : "Loom · " +
          { ok: "Available", attention: "Partly available", offline: "Offline" }[report.state],
    ];
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
    var apps = [];
    if (report.version === 2) {
      if (!Array.isArray(report.apps) || report.apps.length > 2) return empty;
      var appNames = { office: "Office", atlas: "Atlas" },
        appSeen = {};
      var capLabels = {
        available: "Available; app permissions apply",
        conditional: "Supported after prior use; check in app",
        unsupported: "Not supported",
        unknown: "Not confirmed; open app",
        unavailable: "Unavailable",
        "approval-needed": "Approval needed",
      };
      for (var a = 0; a < report.apps.length; a++) {
        var app = report.apps[a];
        if (
          !app ||
          !appNames[app.id] ||
          appSeen[app.id] ||
          ["reachable", "unavailable"].indexOf(app.server) < 0 ||
          ["connected", "setup-needed", "approval-needed", "unavailable"].indexOf(app.cli) < 0 ||
          ["live", "retained", "unknown"].indexOf(app.declaration) < 0 ||
          app.pendingCount !== null
        )
          return empty;
        appSeen[app.id] = true;
        for (var c = 0; c < 4; c++) {
          var value = app[["reading", "writing", "search", "pending"][c]];
          if (
            !value ||
            !capLabels[value.state] ||
            typeof value.detail !== "string" ||
            value.detail.length > 512 ||
            hasControls(value.detail)
          )
            return empty;
        }
        if (
          app.search.state === "available" &&
          (app.server !== "reachable" || app.cli !== "connected" || app.declaration !== "live")
        )
          return empty;
        if (app.pending.state !== "unknown") return empty;
        if (
          app.deviceReview !== undefined &&
          (!app.deviceReview ||
            ["available", "unsupported", "unknown"].indexOf(app.deviceReview.state) < 0 ||
            typeof app.deviceReview.detail !== "string" ||
            app.deviceReview.detail.length > 512 ||
            hasControls(app.deviceReview.detail))
        )
          return empty;

        if (report.state === "ok" && (app.server !== "reachable" || app.cli !== "connected"))
          return empty;
        lines.push(
          appNames[app.id] +
            ": server " +
            (app.server === "reachable" ? "online" : "unavailable") +
            "; CLI " +
            app.cli,
        );
        if (app.declaration === "retained")
          lines.push("  Offline support: last verified declaration, not current device data");
        lines.push("  Saved reading: " + capLabels[app.reading.state]);
        lines.push("  Offline writing: " + capLabels[app.writing.state]);
        lines.push("  Live search: " + capLabels[app.search.state]);
        lines.push("  Pending changes: not reported by app");
        if (app.deviceReview && app.deviceReview.state === "available")
          lines.push(
            "  Device status: review saved copies, conflicts and storage in " + appNames[app.id],
          );
        apps.push(app);
      }
    }
    lines.push("Open What works now for status and recovery.");
    return {
      state: report.state,
      aiReady: report.aiReady,
      tooltip: lines.join("\n"),
      components: report.components,
      apps: apps,
    };
    // oxlint-disable-next-line no-unused-vars -- Qt requires a catch binding.
  } catch (error) {
    return empty;
  }
}
