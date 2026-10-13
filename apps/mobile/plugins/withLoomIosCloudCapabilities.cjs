"use strict";

const { withEntitlementsPlist } = require("expo/config-plugins");

// Register before the notification/Clerk/widget plugins so this runs after their entitlement mods.
module.exports = function withLoomIosCloudCapabilities(
  config,
  { pushEnabled = false, appleSignInEnabled = false } = {},
) {
  return withEntitlementsPlist(config, (modConfig) => {
    if (!pushEnabled) delete modConfig.modResults["aps-environment"];
    if (!appleSignInEnabled) delete modConfig.modResults["com.apple.developer.applesignin"];
    return modConfig;
  });
};
