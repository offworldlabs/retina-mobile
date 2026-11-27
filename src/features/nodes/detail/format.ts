export const DASH = '—';

export function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** A number the server may have left out or sent as something else: 0 for anything but a finite number. */
export function numberOr0(value: unknown): number {
  return finite(value) ? value : 0;
}

/** A value with its unit, to at most `decimals` places; a dash when missing. */
export function measure(value: number | null | undefined, unit: string, decimals: number): string {
  if (!finite(value)) return DASH;
  const number = value.toLocaleString(undefined, { maximumFractionDigits: decimals });
  return unit === '°' ? `${number}°` : `${number} ${unit}`;
}

export function formatDuration(seconds: unknown): string {
  if (!finite(seconds)) return DASH;
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

export function formatSampleRate(hz: number | null | undefined): string {
  return finite(hz) && hz > 0 ? `${(hz / 1e6).toFixed(2)} MSps` : DASH;
}

/** One end of the node's pair: coordinates to five places, then the altitude when declared. */
export function formatPosition(
  lat: number | null | undefined,
  lon: number | null | undefined,
  altFt: number | null | undefined,
): string {
  const at = finite(lat) && finite(lon) ? `${lat.toFixed(5)}, ${lon.toFixed(5)}` : null;
  const alt = finite(altFt) ? measure(altFt, 'ft', 1) : null;
  if (!at && !alt) return DASH;
  return alt ? `${at ?? DASH} / ${alt}` : (at ?? DASH);
}
