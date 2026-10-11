import { parentPort } from "node:worker_threads";
parentPort.once("message", () => {
  for (;;) {}
});
