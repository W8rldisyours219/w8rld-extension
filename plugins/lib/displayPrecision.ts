/** Presentation only. Never feed these strings/rounded figures into arithmetic,
 * persistence, fee quotes or execution amounts. Convert currencies first. */
export type DisplayUnit = 'USD' | 'Frost' | 'native' | 'percent';
export type DisplayOptions = { unit: DisplayUnit; currency?: string; signed?: boolean };
export type DisplayEstimate = { text: string; exact: string; rounded: boolean };

export function formatEstimate(value: number, options: DisplayOptions): DisplayEstimate {
  if (!Number.isFinite(value)) return { text: 'Unavailable', exact: 'Unavailable', rounded: false };
  const normalized = Object.is(value, -0) ? 0 : value;
  const magnitude = Math.abs(normalized);
  const estimate = options.unit === 'USD' || options.unit === 'Frost';
  const digits = options.unit === 'percent' ? 2 : 3;
  const significant = estimate || magnitude > 0 && magnitude < 10 ** -digits;
  const scientific = magnitude > 0 && magnitude < 0.000001;
  const base: Intl.NumberFormatOptions = {
    ...(options.unit === 'USD' ? { style: 'currency', currency: options.currency ?? 'USD' } : {}),
    ...(options.signed ? { signDisplay: 'exceptZero' } : {}),
    ...(scientific ? { notation: 'scientific' } : {}),
    minimumFractionDigits: 0,
  };
  const roundedValue = significant ? Number(normalized.toPrecision(3)) : Number(normalized.toFixed(digits));
  const rounded = roundedValue !== normalized;
  const text = new Intl.NumberFormat('en-US', {
    ...base, ...(significant ? { maximumSignificantDigits: 3 } : { maximumFractionDigits: digits }),
  }).format(normalized);
  const exact = new Intl.NumberFormat('en-US', { ...base, notation: 'standard', maximumSignificantDigits: 21 }).format(normalized);
  return { text: (rounded ? '≈ ' : '') + text, exact, rounded };
}
