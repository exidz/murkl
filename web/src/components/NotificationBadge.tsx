import { memo, useRef, useEffect, type FC } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import './NotificationBadge.css';

interface Props {
  /** Number to display (0 = hidden, > 99 shows "99+") */
  count: number;
  /** Max count before showing "+" suffix */
  max?: number;
  /** Show dot only (no number) */
  dot?: boolean;
  /** Pulse animation for urgency */
  pulse?: boolean;
  /** Custom className */
  className?: string;
  /** Accessible label override */
  'aria-label'?: string;
}

// Trigger haptic on badge appearance
const triggerHaptic = (pattern: number | number[] = 8) => {
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Silently fail
    }
  }
};

/**
 * Venmo-style notification badge.
 *
 * Features:
 * - Animated entrance (spring bounce)
 * - Count change animation (scale bump)
 * - Pulse ring for attention
 * - Haptic feedback on appearance
 * - Dot-only mode for subtle indicators
 * - Respects reduced motion
 * - Accessible with ARIA labels
 */
export const NotificationBadge: FC<Props> = memo(({
  count,
  max = 99,
  dot = false,
  pulse = true,
  className = '',
  'aria-label': ariaLabel,
}) => {
  const reducedMotion = useReducedMotion();
  const prevCountRef = useRef(count);
  const isVisible = count > 0;

  // Haptic feedback when badge first appears or count increases
  useEffect(() => {
    if (count > 0 && prevCountRef.current === 0) {
      triggerHaptic([8, 4, 12]);
    } else if (count > prevCountRef.current) {
      triggerHaptic(8);
    }
    prevCountRef.current = count;
  }, [count]);

  // Format display text
  const displayText = dot
    ? ''
    : count > max
      ? `${max}+`
      : String(count);

  // Determine badge size class
  const sizeClass = dot
    ? 'badge-dot'
    : displayText.length >= 3
      ? 'badge-wide'
      : displayText.length >= 2
        ? 'badge-medium'
        : 'badge-single';

  const label = ariaLabel ?? `${count} notification${count !== 1 ? 's' : ''}`;

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.span
          className={`notification-badge ${sizeClass} ${className}`}
          role="status"
          aria-label={label}
          initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0, y: 2 }}
          animate={reducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0 }}
          transition={
            reducedMotion
              ? { duration: 0.1 }
              : {
                  type: 'spring',
                  stiffness: 500,
                  damping: 20,
                }
          }
          key="badge"
        >
          {/* Count text with change animation */}
          {!dot && (
            <AnimatePresence mode="wait">
              <motion.span
                key={displayText}
                className="badge-text"
                initial={reducedMotion ? {} : { scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={reducedMotion ? {} : { scale: 0.6, opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                {displayText}
              </motion.span>
            </AnimatePresence>
          )}

          {/* Pulse ring for attention */}
          {pulse && !reducedMotion && (
            <span className="badge-pulse" aria-hidden="true" />
          )}
        </motion.span>
      )}
    </AnimatePresence>
  );
});

NotificationBadge.displayName = 'NotificationBadge';

export default NotificationBadge;
