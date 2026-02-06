import {
  useRef,
  useEffect,
  useCallback,
  useState,
  useImperativeHandle,
  forwardRef,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import './AmountInput.css';

export interface AmountInputHandle {
  /** Trigger shake animation (e.g. on invalid submit) */
  shake: () => void;
  /** Focus the input */
  focus: () => void;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  currency?: string;
  currencySymbol?: string;
  /** If currencySymbol is a URL (http/https), it will be rendered as an image. */
  placeholder?: string;
  maxDecimals?: number;
  autoFocus?: boolean;
  disabled?: boolean;
  /**
   * Show the currency label below the amount (e.g. "SOL").
   *
   * Default: true. For the Venmo-style send screen, you may want this off
   * because the token selector already communicates the currency.
   */
  showCurrencyLabel?: boolean;
}

// Trigger haptic feedback on supported devices
const triggerHaptic = (pattern: number | number[] = 6) => {
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Silently fail
    }
  }
};

/**
 * Calculate font size based on the visual width of the value.
 * Accounts for character widths: digits are wider than decimals/commas.
 */
const getFontSize = (value: string): number => {
  if (!value) return 64;

  // Approximate character "weight" (digits ~1.0, decimal ~0.4)
  let weight = 0;
  for (const ch of value) {
    if (ch === '.') weight += 0.4;
    else weight += 1;
  }

  if (weight <= 3) return 64;
  if (weight <= 4.5) return 56;
  if (weight <= 6) return 48;
  if (weight <= 8) return 40;
  if (weight <= 10) return 34;
  return 28;
};

// Shake animation keyframes
const shakeVariants = {
  idle: { x: 0 },
  shake: {
    x: [0, -12, 10, -8, 6, -3, 0],
    transition: { duration: 0.45, ease: 'easeInOut' as const },
  },
};

/**
 * Normalize a human-entered amount string into a canonical form using '.'
 * as the decimal separator and no grouping separators.
 *
 * Handles common paste formats:
 * - "1,234.56" (comma grouping, dot decimal)
 * - "1 234,56" (space grouping, comma decimal)
 * - "1.234,56" (dot grouping, comma decimal)
 * - "◎ 0.5" (token icon/prefix)
 */
export function normalizeAmountInput(raw: string, maxDecimals: number): string {
  // Keep only digits + separators we understand.
  let v = raw.replace(/[^0-9.,]/g, '');

  const lastDot = v.lastIndexOf('.');
  const lastComma = v.lastIndexOf(',');

  // Decide which separator is the decimal separator, if any.
  // If both exist, whichever appears last is the decimal separator.
  const hasDot = lastDot !== -1;
  const hasComma = lastComma !== -1;

  let decimalSep: '.' | ',' | null = null;
  if (hasDot && hasComma) {
    decimalSep = lastDot > lastComma ? '.' : ',';
  } else if (hasDot) {
    decimalSep = '.';
  } else if (hasComma) {
    decimalSep = ',';
  }

  if (decimalSep) {
    const idx = decimalSep === '.' ? lastDot : lastComma;
    const intPart = v.slice(0, idx);
    const fracPart = v.slice(idx + 1);

    // Strip all separators from integer part (grouping).
    const intClean = intPart.replace(/[.,]/g, '');
    // Strip separators from fractional part too (in case user pasted weirdly).
    const fracClean = fracPart.replace(/[.,]/g, '');

    v = `${intClean}.${fracClean}`;
  } else {
    // No decimal separator — strip all grouping separators.
    v = v.replace(/[.,]/g, '');
  }

  // Allow only one decimal point.
  const parts = v.split('.');
  if (parts.length > 2) {
    // Keep the first dot and join the rest (rare but possible paste cases).
    v = `${parts[0]}.${parts.slice(1).join('')}`;
  }

  const [whole, frac] = v.split('.') as [string, string?];

  // Allow starting with "." → treat as "0."
  if (v === '.') return '0.';

  // Limit decimal places.
  if (frac !== undefined && frac.length > maxDecimals) {
    return `${whole}.${frac.slice(0, maxDecimals)}`;
  }

  // Prevent leading zeros (except "0." for decimals)
  if (whole.length > 1 && whole.startsWith('0')) {
    const nextWhole = whole.replace(/^0+/, '') || '0';
    return frac !== undefined ? `${nextWhole}.${frac}` : nextWhole;
  }

  return v;
}

/**
 * Venmo-style hero amount input.
 *
 * The input IS the visual display - no hidden overlay tricks.
 * This ensures the caret is always properly positioned and visible.
 *
 * Features:
 * - Auto-sizing font based on value length
 * - Haptic feedback on input
 * - Shake animation for validation errors (via ref)
 * - Subtle glow when focused
 * - Accessible with proper input modes
 * - Respects reduced motion preference
 */
export const AmountInput = forwardRef<AmountInputHandle, Props>(({
  value,
  onChange,
  onSubmit,
  currency = 'SOL',
  currencySymbol = '◎',
  placeholder = '0',
  maxDecimals = 9,
  autoFocus = false,
  disabled = false,
  showCurrencyLabel = true,
}, ref) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const displayRef = useRef<HTMLDivElement>(null);
  const [isShaking, setIsShaking] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [underlinePx, setUnderlinePx] = useState<{ idle: number; focused: number; idleScale: number }>(() => ({
    idle: 140,
    focused: 140,
    idleScale: 0.71,
  }));
  const prevValueRef = useRef(value);
  const reducedMotion = useReducedMotion();

  // Expose imperative methods
  useImperativeHandle(ref, () => ({
    shake: () => {
      setIsShaking(true);
      triggerHaptic([20, 30, 20]);
      // Reset after animation completes
      setTimeout(() => setIsShaking(false), 500);
    },
    focus: () => inputRef.current?.focus(),
  }), []);

  // Focus on mount if autoFocus
  useEffect(() => {
    if (autoFocus) {
      const timer = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [autoFocus]);

  // Haptic on value change (not on mount)
  useEffect(() => {
    if (prevValueRef.current !== value && value) {
      triggerHaptic(4);
    }
    prevValueRef.current = value;
  }, [value]);

  // Handle input change with normalization + validation
  const handleChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const normalized = normalizeAmountInput(e.target.value, maxDecimals);

    // If the user pasted something totally invalid, just keep it empty.
    // (normalizeAmountInput already strips most junk.)
    onChange(normalized);
  }, [onChange, maxDecimals]);

  // Handle enter key
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && onSubmit) {
      e.preventDefault();
      onSubmit();
    }
  }, [onSubmit]);

  // Calculate font size
  const fontSize = getFontSize(value);
  const isEmpty = !value;

  // Keep the Venmo-style underline proportional to the visible amount width.
  // This helps the hero input feel "centered" even for long values.
  useEffect(() => {
    const el = displayRef.current;
    if (!el) return;

    const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

    const update = () => {
      // scrollWidth is reliable for content width across browsers.
      const w = el.scrollWidth;
      // Add a bit of breathing room so the underline extends past the text.
      const focused = clamp(w + 28, 120, 320);
      const idle = clamp(Math.round(focused * 0.75), 80, focused);
      const idleScale = idle / focused;
      setUnderlinePx({ idle, focused, idleScale });
    };

    update();

    // ResizeObserver catches font-size changes and icon image load.
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => update());
      ro.observe(el);
    }

    return () => ro?.disconnect();
  }, [value, fontSize, currencySymbol]);

  const focusInput = useCallback(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled]);

  return (
    <motion.div
      className={`amount-input-wrapper ${isFocused ? 'focused' : ''} ${isEmpty ? 'empty' : ''} ${showCurrencyLabel ? '' : 'no-label'}`}
      style={{
        ['--underline-width' as any]: `${underlinePx.idle}px`,
        ['--underline-width-focused' as any]: `${underlinePx.focused}px`,
        ['--underline-scale-idle' as any]: underlinePx.idleScale,
      }}
      variants={shakeVariants}
      animate={isShaking ? 'shake' : 'idle'}
      whileTap={disabled ? undefined : { scale: 0.995 }}
      onPointerDown={(e) => {
        // Make the whole hero area tap-to-focus (mobile-friendly).
        // Avoid preventing normal text selection when the actual input is targeted.
        if (disabled) return;
        const el = e.target as HTMLElement | null;
        if (el && el.tagName === 'INPUT') return;
        // Prevent the wrapper tap from stealing focus/selection behavior.
        e.preventDefault();
        focusInput();
      }}
      onClick={() => {
        // Desktop click fallback (some browsers don't fire pointer events consistently)
        focusInput();
      }}
      role="group"
      aria-label={`Amount input${currency ? ` (${currency})` : ''}`}
    >
      {/* Currency symbol */}
      <div className="amount-display-container" ref={displayRef}>
        <motion.span
          className="amount-currency"
          initial={false}
          animate={{
            fontSize: Math.round(fontSize * 0.55),
            opacity: isEmpty ? 0.3 : 0.55,
          }}
          transition={
            reducedMotion
              ? { duration: 0.1 }
              : { type: 'spring', stiffness: 300, damping: 30 }
          }
          aria-hidden="true"
        >
          {currencySymbol.startsWith('http') ? (
            <img
              src={currencySymbol}
              alt=""
              width={Math.round(fontSize * 0.55)}
              height={Math.round(fontSize * 0.55)}
              loading="lazy"
              decoding="async"
              style={{ borderRadius: 6, verticalAlign: 'middle' }}
            />
          ) : (
            currencySymbol
          )}
        </motion.span>

        {/* The actual input - this IS the visual display */}
        <motion.input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          enterKeyHint={onSubmit ? 'done' : undefined}
          autoCapitalize="none"
          className="amount-input"
          value={value}
          placeholder={placeholder}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={disabled}
          aria-label={`Amount in ${currency}`}
          initial={false}
          animate={{ fontSize }}
          transition={
            reducedMotion
              ? { duration: 0.1 }
              : { type: 'spring', stiffness: 300, damping: 30 }
          }
        />
      </div>

      {/* Currency label below (optional) */}
      {showCurrencyLabel && (
        <AnimatePresence mode="wait">
          <motion.p
            key={currency}
            className="amount-label"
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.15 }}
            aria-hidden="true"
          >
            {currency}
          </motion.p>
        </AnimatePresence>
      )}

      {/* Focus glow - subtle radial behind the input */}
      {isFocused && !reducedMotion && (
        <motion.div
          className="amount-focus-glow"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ duration: 0.3 }}
          aria-hidden="true"
        />
      )}
    </motion.div>
  );
});

AmountInput.displayName = 'AmountInput';

export default AmountInput;
