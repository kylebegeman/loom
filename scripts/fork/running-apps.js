// osascript's JavaScript runtime provides AppKit without a package dependency.
// Only registered GUI applications count; Electron's Node-mode helpers do not.
ObjC.import("AppKit");

// oxlint-disable-next-line no-unused-vars -- osascript calls this entrypoint with command-line arguments.
function run(paths) {
  const apps = $.NSWorkspace.sharedWorkspace.runningApplications;
  for (let i = 0; i < apps.count; i++) {
    const app = apps.objectAtIndex(i);
    if (!app.bundleURL) continue;
    if (paths.includes(ObjC.unwrap(app.bundleURL.path))) return "running";
  }
  return "stopped";
}
