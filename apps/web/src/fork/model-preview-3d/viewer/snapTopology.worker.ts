import { buildTopology } from "./snap";
const workerScope = self as unknown as Pick<Worker, "addEventListener" | "postMessage">;
workerScope.addEventListener(
  "message",
  (event: MessageEvent<{ id: number; positions: Float32Array; index: Uint32Array | null }>) => {
    const { id, positions, index } = event.data;
    try {
      const topology = buildTopology(positions, index);
      workerScope.postMessage(
        { id, topology },
        Object.values(topology).map((array) => array.buffer),
      );
    } catch (cause) {
      workerScope.postMessage(
        { id, error: cause instanceof Error ? cause.message : String(cause) },
        [],
      );
    }
  },
);
