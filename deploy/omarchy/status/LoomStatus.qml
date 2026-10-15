import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "StatusModel.js" as StatusModel

BarWidget {
  id: root
  moduleName: "loom.status"
  property string reportText: ""
  property double checkedNow: Date.now()
  property double lastHeartbeat: Date.now()
  property double minimumSampleAt: Date.now()
  property int statusGeneration: 0
  property int checkGeneration: 0
  property bool suspended: false
  property var connection: StatusModel.view(reportText, checkedNow, minimumSampleAt)
  property string executable: Quickshell.env("HOME") + "/.local/bin/loom-os"

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  function invalidate() {
    statusGeneration += 1
    minimumSampleAt = Date.now()
    reportText = ""
  }
  function updateClock() {
    var now = Date.now()
    var next = StatusModel.freshness(lastHeartbeat, now, minimumSampleAt)
    lastHeartbeat = now
    checkedNow = now
    if (next.refresh) invalidate()
    return next.refresh
  }
  function refresh() {
    updateClock()
    if (!suspended && !check.running) { checkGeneration = statusGeneration; check.running = true }
  }
  function invalidateAndRefresh() {
    invalidate()
    refresh()
  }
  function setSuspended(value) {
    suspended = value
    invalidate()
    if (!value) refresh()
  }
  function openAvailability() {
    root.refresh()
    if (root.bar) root.bar.run(Util.shellQuote(root.executable) + " availability")
  }
  Component.onCompleted: root.refresh()

  // Wall-clock gaps invalidate pre-suspend results before a fresh check can complete.
  Timer {
    interval: 1000
    running: root.visible && !root.suspended
    repeat: true
    onTriggered: if (root.updateClock()) root.refresh()
  }

  // Bounded read-only checks, no repaint animation and no provider inference.
  Timer {
    interval: 30000
    running: root.visible && !root.suspended
    repeat: true
    onTriggered: root.refresh()
  }
  Process {
    id: check
    command: [root.executable, "availability", "--json"]
    stdout: StdioCollector { id: output; waitForEnd: true }
    onExited: function(exitCode) {
      root.updateClock()
      root.reportText = exitCode === 0 && !root.suspended && root.checkGeneration === root.statusGeneration ? output.text : ""
      if (!root.suspended && root.checkGeneration !== root.statusGeneration) root.refresh()
    }
  }
  // The ordinary logind signal clears readiness before sleep, even for short suspends.
  // Keep an in-flight credential refresh running; discard its result by generation.
  Process {
    command: ["dbus-monitor", "--system", "type='signal',sender='org.freedesktop.login1',path='/org/freedesktop/login1',interface='org.freedesktop.login1.Manager',member='PrepareForSleep'"]
    running: root.visible
    stdout: SplitParser {
      onRead: data => {
        var value = data.trim()
        if (value === "boolean true") root.setSuspended(true)
        if (value === "boolean false") root.setSuspended(false)
      }
    }
  }
  IpcHandler {
    target: "loom.status"
    function refresh(): string { root.broadcast("invalidateAndRefresh"); return "ok" }
    function open(): string { root.openAvailability(); return "ok" }
    function status(): string { return JSON.stringify(root.connection) }
  }
  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.connection.state === "ok" ? "\udb80\udf35" : root.connection.state === "attention" ? "!" : "×"
    foreground: root.connection.state === "ok"
      ? (root.bar ? root.bar.barForeground : Color.foreground)
      : root.connection.state === "attention" ? Color.accent : Color.urgent
    opacity: root.connection.state === "offline" ? 0.7 : 1
    tooltipText: root.connection.tooltip
    activeFocusOnTab: true
    Accessible.role: Accessible.Button
    Accessible.name: "Loom availability. " + root.connection.tooltip
    Keys.onReturnPressed: root.openAvailability()
    Keys.onSpacePressed: root.openAvailability()
    onPressed: root.openAvailability()
  }
}
