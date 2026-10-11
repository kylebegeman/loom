import type { PrintEstimate } from "@t3tools/contracts/fork";
export const formatDuration = (seconds: number | null): string => {
  if (seconds === null) return "Time unavailable";
  if (seconds < 60) return "Under a minute";
  const minutes = Math.round(seconds / 60),
    hours = Math.floor(minutes / 60),
    days = Math.floor(hours / 24);
  return [
    days ? `${days} d` : "",
    hours % 24 ? `${hours % 24} h` : "",
    minutes % 60 ? `${minutes % 60} m` : "",
  ]
    .filter(Boolean)
    .join(" ");
};
export const formatEstimate = (estimate: PrintEstimate): string => {
  const filaments = estimate.filaments
    .map((filament) =>
      [filament.grams === null ? "" : `${Math.round(filament.grams)} g`, filament.type ?? ""]
        .filter(Boolean)
        .join(" "),
    )
    .filter(Boolean);
  return [formatDuration(estimate.printSeconds), filaments.join(" + ")].filter(Boolean).join(", ");
};
export const formatCost = (amount: number | null, currency: string): string | null =>
  amount === null
    ? null
    : new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
