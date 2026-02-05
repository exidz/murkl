import {
  useState,
  useCallback,
  useRef,
  useEffect,
  type FC,
  type TouchEvent,
  type KeyboardEvent,
} from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Button } from './Button';
import './PasswordSheet.css';

interface Deposit {
  amount: number;
  token: string;
}

export interface PasswordSheetProps {
  deposit: Deposit;
  password: string;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  wasmReady: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

// Minimum swipe distance to dismiss
const SWIPE_DISMISS_THRESHOLD = 120;

// Trigger haptic feedback on supported devices
const triggerHaptic = (pattern: number | number[] = 10) => {
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Silently fail
    }
  }
};

/**
 * Venmo-style password entry bottom sheet for claim flow.
 *
 * This is a critical UX touchpoint — the gate between the user and their funds.
 * Must feel trustworthy, simple, and satisfying.
 *
 * Features (aligned with DESIGN.md):
 * - Hero amount display — show what they're about to claim
 * - One primary action per screen — "Claim" is the hero button
 * - Swipe-to-dismiss gesture — natural mobile interaction
 * - Privacy assurance badge — trust through transparency
 * - Visual feedback while typing — character progress bar
 * - Show/hide password toggle
 * - Haptic feedback on key moments
 * - Body scroll lock when open
 * - Keyboard accessible (Escape to close, Enter to submit)
 * - Respects reduced motion preference
 */
export const PasswordSheet: FC<PasswordSheetProps> = ({
  deposit,
  password,
  onPasswordChange,
  onSubmit,
  onClose,
  wasmReady,
  inputRef,
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragY, setDragY] = useState(0);
  const touchStartRef = useRef<{ y: number; time: number } | null>(null);
  const reducedMotion = useReducedMotion();

  const isReady = password.length >= 8;
  const charProgress = Math.min(password.length / 8, 1);

  // Lock body scroll when sheet is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  // Focus input on mount
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 200);
    return () => clearTimeout(timer);
  }, [inputRef]);

  // Haptic on reaching ready state
  useEffect(() => {
    if (isReady && password.length === 8) {
      triggerHaptic([10, 5, 15]);
    }
  }, [isReady, password.length]);

  // Handle Enter key to submit, Escape to close
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && isReady) {
      e.preventDefault();
      onSubmit();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [isReady, onSubmit, onClose]);

  // Touch handlers for swipe-to-dismiss
  const handleTouchStart = useCallback((e: TouchEvent) => {
    touchStartRef.current = {
      y: e.touches[0].clientY,
      time: Date.now(),
    };
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!touchStartRef.current) return;

    const deltaY = e.touches[0].clientY - touchStartRef.current.y;

    // Only allow dragging downward
    if (deltaY > 0) {
      setIsDragging(true);
      setDragY(deltaY);
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!touchStartRef.current) return;

    const velocity = isDragging
      ? dragY / (Date.now() - touchStartRef.current.time)
      : 0;

    // Dismiss if swiped far enough or with enough velocity
    if (dragY > SWIPE_DISMISS_THRESHOLD || velocity > 0.5) {
      triggerHaptic(15);
      onClose();
    }

    touchStartRef.current = null;
    setIsDragging(false);
    setDragY(0);
  }, [dragY, isDragging, onClose]);

  // Toggle password visibility
  const handleToggleVisibility = useCallback(() => {
    setShowPassword(prev => !prev);
    triggerHaptic(6);
    // Refocus input after toggle
    inputRef.current?.focus();
  }, [inputRef]);

  // Drag transform for sheet
  const dragStyle = isDragging
    ? { transform: `translateY(${dragY}px)`, transition: 'none' }
    : {};

  // Spring config respecting reduced motion
  const springConfig = reducedMotion
    ? { duration: 0.15 }
    : { type: 'spring' as const, damping: 28, stiffness: 300 };

  return (
    <>
      {/* Backdrop */}
      <motion.div
        className="pw-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reducedMotion ? 0.1 : 0.2 }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <motion.div
        className="pw-sheet"
        style={dragStyle}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={springConfig}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pw-title"
      >
        {/* Drag handle */}
        <div
          className="pw-handle"
          onClick={onClose}
          role="button"
          tabIndex={0}
          aria-label="Close"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') onClose();
          }}
        >
          <div className="pw-handle-bar" />
        </div>

        <div className="pw-content">
          {/* Hero section — amount is the star */}
          <motion.div
            className="pw-hero"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05, duration: 0.25 }}
          >
            <motion.div
              className="pw-icon"
              initial={reducedMotion ? {} : { scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={reducedMotion ? { duration: 0.1 } : {
                type: 'spring',
                stiffness: 300,
                damping: 20,
                delay: 0.1,
              }}
            >
              <AnimatePresence mode="wait">
                <motion.span
                  key={isReady ? 'unlocked' : 'locked'}
                  initial={reducedMotion ? {} : { scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={reducedMotion ? {} : { scale: 0.5, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  {isReady ? '🔓' : '🔑'}
                </motion.span>
              </AnimatePresence>
            </motion.div>

            <h3 className="pw-title" id="pw-title">
              {isReady ? 'Ready to claim' : 'Enter password'}
            </h3>

            <motion.div
              className="pw-amount-row"
              initial={reducedMotion ? {} : { opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.15, type: 'spring', stiffness: 250 }}
            >
              <span className="pw-amount-value">{deposit.amount}</span>
              <span className="pw-amount-token">{deposit.token}</span>
            </motion.div>
          </motion.div>

          {/* Password input section */}
          <motion.div
            className="pw-input-section"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            <p className="pw-input-label">
              The sender shared this with you
            </p>

            <div className="pw-input-wrapper">
              <input
                ref={inputRef}
                type={showPassword ? 'text' : 'password'}
                className={[
                  'pw-input',
                  password.length > 0 && 'has-value',
                  isReady && 'ready',
                ].filter(Boolean).join(' ')}
                placeholder="Password..."
                value={password}
                onChange={(e) => onPasswordChange(e.target.value)}
                onKeyDown={handleKeyDown}
                autoComplete="off"
                spellCheck={false}
                aria-label="Claim password"
                aria-describedby="pw-hint"
              />

              <motion.button
                type="button"
                className="pw-toggle"
                onClick={handleToggleVisibility}
                whileTap={reducedMotion ? undefined : { scale: 0.9 }}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? '🙈' : '👁️'}
              </motion.button>
            </div>

            {/* Character progress bar — fills to 8 chars then turns green */}
            <div className="pw-char-progress" aria-hidden="true">
              <motion.div
                className={`pw-char-progress-fill ${isReady ? 'complete' : 'filling'}`}
                initial={{ width: 0 }}
                animate={{ width: `${charProgress * 100}%` }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
              />
            </div>

            {/* Hint / status */}
            <motion.div
              id="pw-hint"
              className={`pw-hint ${isReady ? 'ready' : ''}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              <AnimatePresence mode="wait">
                {password.length === 0 ? (
                  <motion.span
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    Paste or type the password
                  </motion.span>
                ) : isReady ? (
                  <motion.span
                    key="ready"
                    className="ready-check"
                    initial={reducedMotion ? {} : { scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 300 }}
                  >
                    ✓ Ready to claim
                  </motion.span>
                ) : (
                  <motion.span
                    key="counting"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    {password.length}/8 characters minimum
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.div>
          </motion.div>

          {/* Privacy assurance */}
          <motion.div
            className="pw-privacy"
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
          >
            <span className="pw-privacy-icon" aria-hidden="true">🔒</span>
            <span>Proven privately — your password never leaves your device</span>
          </motion.div>

          {/* Actions — stacked, Claim is the hero */}
          <motion.div
            className="pw-actions"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={onSubmit}
              disabled={!isReady || !wasmReady}
              loading={!wasmReady}
              loadingText="Loading prover..."
            >
              Claim {deposit.amount} {deposit.token}
            </Button>

            {!wasmReady && (
              <p className="pw-wasm-notice">
                Initializing zero-knowledge prover…
              </p>
            )}

            <button
              className="pw-cancel"
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
          </motion.div>
        </div>
      </motion.div>
    </>
  );
};

export default PasswordSheet;
