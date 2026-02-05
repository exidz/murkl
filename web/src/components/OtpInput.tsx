import { 
  useRef, 
  useEffect, 
  useState, 
  useCallback,
  type FC, 
  type ChangeEvent,
  type KeyboardEvent,
  type ClipboardEvent,
} from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import './OtpInput.css';

interface Props {
  /** Current OTP value (digits only) */
  value: string;
  /** Called when value changes */
  onChange: (val: string) => void;
  /** Called when all digits are filled */
  onComplete: () => void;
  /** Number of digits (default 6) */
  length?: number;
  /** Auto-focus on mount */
  autoFocus?: boolean;
  /** Visual size variant */
  size?: 'md' | 'lg';
  /** Disabled state */
  disabled?: boolean;
  /** Error state — triggers shake animation */
  error?: boolean;
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

// Shake animation for error state
const shakeVariants = {
  idle: { x: 0 },
  shake: {
    x: [0, -10, 8, -6, 4, -2, 0],
    transition: { duration: 0.4, ease: 'easeInOut' as const },
  },
};

/**
 * Segmented OTP input — individual digit boxes with a single hidden native input.
 *
 * Venmo-style: clean, centered, satisfying feedback on each digit.
 * Features:
 * - Spring animation on digit entry
 * - Haptic feedback on each digit
 * - Shake animation on error
 * - Paste support from clipboard
 * - Auto-submit on completion
 * - Caret animation on active segment
 * - Respects reduced motion preference
 */
export const OtpInput: FC<Props> = ({
  value,
  onChange,
  onComplete,
  length = 6,
  autoFocus,
  size = 'md',
  disabled = false,
  error = false,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const prevLengthRef = useRef(value.length);
  const reducedMotion = useReducedMotion();

  // Auto-focus on mount
  useEffect(() => {
    if (autoFocus && !disabled) {
      const timer = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [autoFocus, disabled]);

  // Trigger complete when all digits filled
  useEffect(() => {
    if (value.length === length) {
      triggerHaptic([10, 30, 10]); // Success pattern
      onComplete();
    }
  }, [value, length, onComplete]);

  // Haptic feedback on digit entry/removal
  useEffect(() => {
    const prevLen = prevLengthRef.current;
    const currLen = value.length;
    
    if (currLen !== prevLen) {
      if (currLen > prevLen) {
        // Digit added
        triggerHaptic(6);
      } else if (currLen < prevLen) {
        // Digit removed (backspace)
        triggerHaptic(4);
      }
    }
    
    prevLengthRef.current = currLen;
  }, [value]);

  // Shake on error prop change
  useEffect(() => {
    if (error) {
      setIsShaking(true);
      triggerHaptic([20, 40, 20, 40, 20]);
      const timer = setTimeout(() => setIsShaking(false), 450);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const handleChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    const raw = e.target.value.replace(/\D/g, '').slice(0, length);
    onChange(raw);
  }, [disabled, length, onChange]);

  // Handle paste explicitly for better UX
  const handlePaste = useCallback((e: ClipboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (pasted.length > 0) {
      e.preventDefault();
      onChange(pasted);
      triggerHaptic([8, 4, 8]); // Paste feedback
    }
  }, [disabled, length, onChange]);

  // Handle backspace at position 0
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    
    // Allow navigation
    if (e.key === 'Backspace' && value.length === 0) {
      // Already empty, no-op
    }
  }, [disabled, value.length]);

  // Clicking any segment focuses the hidden input
  const focusInput = useCallback(() => {
    if (!disabled) {
      inputRef.current?.focus();
    }
  }, [disabled]);

  const digits = value.split('');
  const activeIndex = digits.length < length ? digits.length : -1;

  return (
    <motion.div
      className={`otp-container otp-${size} ${disabled ? 'disabled' : ''}`}
      onClick={focusInput}
      role="group"
      aria-label="Verification code"
      variants={shakeVariants}
      animate={isShaking ? 'shake' : 'idle'}
    >
      {/* Hidden native input that captures all keyboard/paste events */}
      <input
        ref={inputRef}
        className="otp-hidden-input"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={length}
        value={value}
        onChange={handleChange}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        disabled={disabled}
        aria-label={`${length}-digit verification code`}
      />
      
      {/* Visual segments */}
      <div className="otp-segments">
        {Array.from({ length }, (_, i) => {
          const digit = digits[i];
          const isActive = i === activeIndex && isFocused;
          const isFilled = !!digit;
          
          return (
            <motion.div
              key={i}
              className={`otp-segment${isFilled ? ' filled' : ''}${isActive ? ' active' : ''}${error ? ' error' : ''}`}
              initial={false}
              animate={isFilled && !reducedMotion ? { 
                scale: [1, 1.08, 1],
              } : {}}
              transition={{ duration: 0.15, ease: 'easeOut' }}
            >
              {/* Digit with pop-in animation */}
              <AnimatePresence mode="wait">
                {digit ? (
                  <motion.span
                    key={`digit-${i}-${digit}`}
                    className="otp-digit"
                    initial={reducedMotion ? { opacity: 1 } : { opacity: 0, scale: 0.5, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.5, y: -8 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                  >
                    {digit}
                  </motion.span>
                ) : isActive ? (
                  <motion.span
                    key="caret"
                    className="otp-caret"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0, 1, 1, 0] }}
                    transition={{ 
                      duration: 1, 
                      repeat: Infinity, 
                      times: [0, 0.1, 0.5, 0.6],
                    }}
                    aria-hidden="true"
                  />
                ) : null}
              </AnimatePresence>
              
              {/* Focus ring glow (subtle) */}
              {isActive && (
                <motion.div
                  className="otp-segment-glow"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.1 }}
                  transition={{ duration: 0.2 }}
                  aria-hidden="true"
                />
              )}
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
};

export default OtpInput;
