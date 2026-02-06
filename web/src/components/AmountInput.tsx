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
  placeholder?: string;
  maxDecimals?: number;
  autoFocus?: boolean;
  disabled?: boolean;
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
 * Venmo-style hero amount input.
 *
 * The input IS the visual display — no hidden overlay tricks.
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
}, ref) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isShaking, setIsShaking] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
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

  // Handle input change with validation
  const handleChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    let newValue = e.target.value;

    // Be forgiving: people paste values like "1,234.56" or "◎ 0.5".
    // 1) Keep digits + decimal separators
    // 2) Remove grouping commas
    // 3) Enforce a single '.' as the decimal separator
    newValue = newValue.replace(/[^0-9.,]/g, '');
    newValue = newValue.replace(/,/g, '');

    // Allow only one decimal point
    const parts = newValue.split('.');
    if (parts.length > 2) return;

    // Limit decimal places
    if (parts[1] !== undefined && parts[1].length > maxDecimals) return;

    // Prevent leading zeros (except "0." for decimals)
    if (parts[0].length > 1 && parts[0].startsWith('0')) {
      parts[0] = parts[0].replace(/^0+/, '') || '0';
      newValue = parts.join('.');
    }

    // Allow starting with "." → treat as "0."
    if (newValue === '.') {
      newValue = '0.';
    }

    onChange(newValue);
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

  return (
    <motion.div
      className={`amount-input-wrapper ${isFocused ? 'focused' : ''} ${isEmpty ? 'empty' : ''}`}
      variants={shakeVariants}
      animate={isShaking ? 'shake' : 'idle'}
    >
      {/* Currency symbol */}
      <div className="amount-display-container">
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
          {currencySymbol}
        </motion.span>

        {/* The actual input — this IS the visual display */}
        <motion.input
          ref={inputRef}
          type="text"
          inputMode="decimal"
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

      {/* Currency label below */}
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

      {/* Focus glow — subtle radial behind the input */}
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
