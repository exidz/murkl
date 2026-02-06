/**
 * Formatting helpers for Murkl UI.
 *
 * Goals:
 * - Friendly, human-readable token amounts (no scientific notation)
 * - Stable-ish output for UI (trim noisy trailing zeros)
 * - No locale surprises in copy/paste (always '.' decimal separator)
 */

export function formatTokenAmount(
  amount: number,
  opts?: {
    /** Maximum decimals to show (default: 6) */
    maxDecimals?: number;
  },
): string {
  const maxDecimals = opts?.maxDecimals ?? 6;

  if (!Number.isFinite(amount)) return '0';

  // Avoid "-0".
  const normalized = Object.is(amount, -0) ? 0 : amount;

  const sign = normalized < 0 ? '-' : '';
  const abs = Math.abs(normalized);

  // Keep a bounded amount of decimals, then trim trailing zeros.
  // (We prefer deterministic output over Intl, and always use '.' as decimal separator.)
  let s = abs.toFixed(Math.min(Math.max(0, maxDecimals), 20));

  // Trim trailing zeros and optional dot.
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');

  const [intPart, fracPart] = s.split('.');
  const groupedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  return fracPart ? `${sign}${groupedInt}.${fracPart}` : `${sign}${groupedInt}`;
}
