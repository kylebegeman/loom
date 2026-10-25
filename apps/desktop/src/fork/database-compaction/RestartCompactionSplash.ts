/** The splash cancels every navigation; following this link skips the compaction. */
export const SPLASH_SKIP_URL = "loom-restart-compaction:skip";

export function formatBytes(bytes: number): string {
  return bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(2)} GiB`
    : bytes >= 1024 ** 2
      ? `${(bytes / 1024 ** 2).toFixed(1)} MiB`
      : `${Math.ceil(bytes / 1024)} KiB`;
}

// Colors match the connecting splash and the window background behind it.
function page(shouldUseDarkColors: boolean, body: string, script = ""): string {
  const background = shouldUseDarkColors ? "#0a0a0a" : "#ffffff";
  const text = shouldUseDarkColors ? "#9ca3af" : "#6b7280";
  const heading = shouldUseDarkColors ? "#f8fafc" : "#1f2937";
  const scriptPolicy = script === "" ? "" : "; script-src 'unsafe-inline'";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'${scriptPolicy}"><style>html,body{margin:0;height:100%}body{background:${background};color:${text};font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:12px;line-height:1.45;display:flex;flex-direction:column;justify-content:center;gap:8px;padding:0 26px;box-sizing:border-box;-webkit-user-select:none;user-select:none;-webkit-app-region:drag}.center{align-items:center;font-size:13px}h1{margin:0;font-size:14px;font-weight:600;color:${heading}}p{margin:0}.row{display:flex;justify-content:space-between;margin-top:6px}a{color:${heading};-webkit-app-region:no-drag}</style></head><body${script === "" ? ' class="center"' : ""}>${body}${script === "" ? "" : `<script>${script}</script>`}</body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/**
 * VACUUM reports no progress, so the page shows what it reclaims and how long
 * it has run. The clock updates once a second; nothing animates.
 */
export function buildCompactionSplashPage(input: {
  readonly shouldUseDarkColors: boolean;
  readonly reclaimableBytes: number;
  readonly startedAt: number;
}): string {
  const elapsed = `const started=${input.startedAt};const out=document.getElementById("elapsed");const tick=()=>{const s=Math.max(0,Math.floor((Date.now()-started)/1000));out.textContent=Math.floor(s/60)+":"+String(s%60).padStart(2,"0")+" elapsed"};tick();setInterval(tick,1000);`;
  return page(
    input.shouldUseDarkColors,
    `<h1>Compacting the database</h1><p>Loom is returning ${formatBytes(input.reclaimableBytes)} of unused space to your disk. This can take several minutes, and Loom opens when it finishes.</p><div class="row"><span id="elapsed"></span><a href="${SPLASH_SKIP_URL}">Skip for now</a></div>`,
    elapsed,
  );
}

/** Shown from the end of compaction until the main window reveals and dismisses it. */
export function buildStartingSplashPage(shouldUseDarkColors: boolean): string {
  return page(shouldUseDarkColors, "<p>Starting Loom…</p>");
}
