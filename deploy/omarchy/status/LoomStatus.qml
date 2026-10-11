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
  property var connection: StatusModel.view(reportText, checkedNow)
  property string executable: Quickshell.env("HOME") + "/.local/bin/loom-os"

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  function refresh() {
    checkedNow = Date.now()
    if (!check.running) check.running = true
  }
  Component.onCompleted: root.refresh()

  // Bounded read-only checks, no repaint animation and no provider inference.
  Timer {
    interval: 30000
    running: root.visible
    repeat: true
    onTriggered: root.refresh()
  }
  Process {
    id: check
    command: [root.executable, "connections"]
    stdout: StdioCollector { id: output; waitForEnd: true }
    onExited: function(exitCode) {
      root.checkedNow = Date.now()
      root.reportText = exitCode === 0 ? output.text : ""
    }
  }
  IpcHandler {
    target: "loom.status"
    function refresh(): string { root.broadcast("refresh"); return "ok" }
    function status(): string { return JSON.stringify(root.connection) }
  }
  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "\udb80\udf35"
    foreground: root.connection.state === "ok"
      ? (root.bar ? root.bar.barForeground : Color.foreground)
      : root.connection.state === "attention" ? Color.accent : Color.urgent
    opacity: root.connection.state === "offline" ? 0.7 : 1
    tooltipText: root.connection.tooltip
    onPressed: {
      root.refresh()
      if (root.bar) root.bar.run("omarchy-menu summon loomos.connections")
    }
  }
}
