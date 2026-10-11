// @effect-diagnostics nodeBuiltinImport:off
import * as NodeWorkerThreads from "node:worker_threads";
import * as NodeOS from "node:os";
import { cubeSoup, binaryStl } from "./fixtures.ts";
import type { CheckReply, CheckRequest } from "./protocol.ts";
const print = (value: string) => process.stdout.write(value + "\n");
const sphere = (target: number) => {
  const rows = Math.floor(Math.sqrt(target / 4)),
    columns = Math.floor(target / (2 * (rows - 1))),
    soup = new Float32Array(columns * (rows - 1) * 18);
  let at = 0;
  const point = (r: number, c: number) => {
    const theta = (Math.PI * r) / rows,
      phi = (2 * Math.PI * c) / columns;
    return [
      50 * Math.sin(theta) * Math.cos(phi),
      50 * Math.sin(theta) * Math.sin(phi),
      50 * (1 - Math.cos(theta)),
    ];
  };
  const triangle = (a: number[], b: number[], c: number[]) => {
    soup.set([...a, ...b, ...c], at);
    at += 9;
  };
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < columns; c++) {
      const a = point(r, c),
        b = point(r, c + 1),
        d = point(r + 1, c),
        e = point(r + 1, c + 1);
      if (r > 0) triangle(a, d, b);
      if (r < rows - 1) triangle(b, d, e);
    }
  return soup;
};
const plates = (target: number) => {
  const divisions = Math.floor(Math.sqrt(target / 120)),
    count = 10,
    soup = new Float32Array(12 * divisions * divisions * count * 9);
  let at = 0;
  for (let plate = 0; plate < count; plate++) {
    const base = cubeSoup([10, 10, 0.6], [plate * 12, 0, 0]);
    for (let t = 0; t < 12; t++) {
      const a = Array.from(base.subarray(t * 9, t * 9 + 3)),
        b = Array.from(base.subarray(t * 9 + 3, t * 9 + 6)),
        c = Array.from(base.subarray(t * 9 + 6, t * 9 + 9)),
        point = (i: number, j: number) =>
          a.map((v, k) => v + ((b[k]! - v) * i) / divisions + ((c[k]! - v) * j) / divisions);
      for (let i = 0; i < divisions; i++)
        for (let j = 0; j < divisions - i; j++) {
          soup.set([...point(i, j), ...point(i + 1, j), ...point(i, j + 1)], at);
          at += 9;
          if (i + j + 1 < divisions) {
            soup.set([...point(i + 1, j), ...point(i + 1, j + 1), ...point(i, j + 1)], at);
            at += 9;
          }
        }
    }
  }
  return soup.subarray(0, at);
};
const run = (soup: Float32Array) =>
  new Promise<{ reply: CheckReply; rssMiB: number }>((resolve, reject) => {
    const worker = new NodeWorkerThreads.Worker(
        new URL("./model-check-worker.ts", import.meta.url),
        { resourceLimits: { maxOldGenerationSizeMb: 512 } },
      ),
      bytes = binaryStl(soup),
      request: CheckRequest = {
        format: "stl",
        files: [{ name: "bench.stl", bytes }],
        orientation: null,
        params: { nozzleMm: 0.4, overhangAngleDegrees: 45, firstLayerMm: 0.2 },
        seed: 42,
        limits: { maxTriangles: 3000000, thicknessBudgetMs: 15000 },
      };
    worker.once("message", (reply: CheckReply) => {
      const rssMiB = process.memoryUsage().rss / 2 ** 20;
      void worker.terminate().then(() => resolve({ reply, rssMiB }));
    });
    worker.once("error", reject);
    worker.postMessage(request, [bytes.buffer]);
  });
print(`${NodeOS.cpus()[0]?.model}; ${NodeOS.totalmem() / 2 ** 30} GiB; ${process.version}`);
for (const target of [100000, 1000000, 3000000])
  for (const [name, make] of [
    ["sphere", sphere],
    ["plates", plates],
  ] as const) {
    const soup = make(target),
      { reply, rssMiB } = await run(soup);
    print(
      JSON.stringify({
        shape: name,
        target,
        rssMiB,
        triangles: soup.length / 9,
        ...(reply.ok ? { durationMs: reply.core.durationMs, stages: reply.core.stages } : reply),
      }),
    );
  }
