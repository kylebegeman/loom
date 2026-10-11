import * as NodeWorkerThreads from "node:worker_threads";
NodeWorkerThreads.parentPort.once("message", () => {
  for (;;) {}
});
