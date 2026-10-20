import { SERVER_SELF_UPDATE_ENV } from "./selfUpdateSwitch.ts";

// A host whose operating system ships Loom exports the switch, and agents and Mini jobs there
// inherit it. The upstream suites expect a server that updates itself, so every test starts
// without it; selfUpdateSwitch.test.ts sets it through its own ConfigProvider.
delete process.env[SERVER_SELF_UPDATE_ENV];
