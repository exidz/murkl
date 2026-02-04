import { memo, type FC, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Button } from './Button';
import './ErrorState.css';

type ErrorVariant = 'network' | 'transaction' | 'wallet' | 'notfound' | 'generic';

interface Props {
  /** Error variant - determines icon and default message */
  variant?: ErrorVariant;
  /** Custom title (overrides variant default) */
  title?: string;
  /** Error message or description */
  message?: string;
  /** Custom icon (overrides variant default) */
  icon?: ReactNode;
  /** Primary retry action */
  onRetry?: () => void;
  /** Custom retry label */
  retryLabel?: string;
  /** Secondary action (e.g., "Go back", "Contact support") */
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  /** Compact mode for inline usage */
  compact?: boolean;
  /** Show technical error details (collapsible) */
  details?: string;
}

// Variant configurations
const variantConfig: Record<ErrorVariant, { icon: ReactNode; title: string; message: string }> = {
  network: {
    icon: (
      <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
        <motion.circle
          cx="40" cy="40" r="24"
          stroke="currentColor" strokeWidth="2" fill="none"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
        <motion.path
          d="M40 28v16M40 52v1"
          stroke="currentColor" strokeWidth="3" strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.4, delay: 0.3 }}
        />
        <motion.path
          d="M25 25L55 55M25 55L55 25"
          stroke="var(--accent-error)" strokeWidth="1.5" strokeLinecap="round" opacity="0.3"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.4, delay: 0.5 }}
        />
      </svg>
    ),
    title: "Connection failed",
    message: "Couldn't reach the network. Check your connection and try again.",
  },
  transaction: {
    icon: (
      <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
        <motion.rect
          x="20" y="28" width="40" height="28" rx="4"
          stroke="currentColor" strokeWidth="2" fill="none"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.5 }}
        />
        <motion.path
          d="M20 38h40"
          stroke="currentColor" strokeWidth="2"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.3, delay: 0.3 }}
        />
        <motion.circle
          cx="56" cy="28" r="10"
          fill="var(--bg-primary)" stroke="var(--accent-error)" strokeWidth="2"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.4, type: "spring" }}
        />
        <motion.path
          d="M52 24l8 8M60 24l-8 8"
          stroke="var(--accent-error)" strokeWidth="2" strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.3, delay: 0.6 }}
        />
      </svg>
    ),
    title: "Transaction failed",
    message: "Something went wrong processing your payment. No funds were moved.",
  },
  wallet: {
    icon: (
      <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
        <motion.rect
          x="16" y="28" width="44" height="32" rx="4"
          stroke="currentColor" strokeWidth="2" fill="none"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.5 }}
        />
        <motion.rect
          x="48" y="38" width="14" height="12" rx="2"
          stroke="currentColor" strokeWidth="2" fill="none"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.3 }}
        />
        <motion.path
          d="M32 40l-8-8M32 48l-8 8"
          stroke="var(--accent-error)" strokeWidth="2" strokeLinecap="round" opacity="0.5"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.3, delay: 0.5 }}
        />
      </svg>
    ),
    title: "Wallet disconnected",
    message: "Your wallet lost connection. Please reconnect to continue.",
  },
  notfound: {
    icon: (
      <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
        <motion.circle
          cx="35" cy="38" r="16"
          stroke="currentColor" strokeWidth="2" fill="none"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.5 }}
        />
        <motion.line
          x1="47" y1="50" x2="58" y2="61"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.3, delay: 0.3 }}
        />
        <motion.path
          d="M29 38h12"
          stroke="var(--accent-error)" strokeWidth="2" strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.3, delay: 0.5 }}
        />
      </svg>
    ),
    title: "Not found",
    message: "We couldn't find what you're looking for. It may have been claimed or expired.",
  },
  generic: {
    icon: (
      <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
        <motion.circle
          cx="40" cy="40" r="24"
          stroke="currentColor" strokeWidth="2" fill="none"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.6 }}
        />
        <motion.path
          d="M40 28v16"
          stroke="var(--accent-error)" strokeWidth="3" strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.3, delay: 0.3 }}
        />
        <motion.circle
          cx="40" cy="52" r="2"
          fill="var(--accent-error)"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.5, type: "spring" }}
        />
      </svg>
    ),
    title: "Something went wrong",
    message: "An unexpected error occurred. Please try again.",
  },
};

/**
 * Venmo-style error state component.
 * 
 * Design principles from DESIGN.md:
 * - Red accent, not aggressive (muted error color)
 * - Clear message + retry action
 * - Friendly copy ("Something went wrong. Try again?")
 * 
 * Use for:
 * - Component-level errors (failed to load data)
 * - Network/RPC failures
 * - Transaction errors (full-screen display)
 * - Not found states
 * - Error boundaries
 */
export const ErrorState: FC<Props> = memo(({
  variant = 'generic',
  title,
  message,
  icon,
  onRetry,
  retryLabel = 'Try again',
  secondaryAction,
  compact = false,
  details,
}) => {
  const reducedMotion = useReducedMotion();
  const config = variantConfig[variant];
  
  const displayIcon = icon || config.icon;
  const displayTitle = title || config.title;
  const displayMessage = message || config.message;

  // Subtle shake animation for error emphasis (respects reduced motion)
  const shakeAnimation = reducedMotion
    ? {}
    : {
        x: [0, -4, 4, -3, 3, -2, 2, 0],
        transition: { duration: 0.5, delay: 0.2 },
      };

  return (
    <motion.div 
      className={`error-state ${compact ? 'compact' : ''}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      role="alert"
      aria-live="polite"
    >
      {/* Illustration / Icon */}
      <motion.div 
        className="error-illustration"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1, ...shakeAnimation }}
        transition={{ delay: 0.1, duration: 0.3 }}
      >
        {displayIcon}
      </motion.div>

      {/* Text content */}
      <div className="error-content">
        <motion.h3 
          className="error-title"
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          {displayTitle}
        </motion.h3>
        
        <motion.p 
          className="error-message"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          {displayMessage}
        </motion.p>

        {/* Collapsible technical details */}
        {details && (
          <motion.details
            className="error-details"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            <summary>Technical details</summary>
            <pre>{details}</pre>
          </motion.details>
        )}
      </div>

      {/* Actions */}
      {(onRetry || secondaryAction) && (
        <motion.div 
          className="error-actions"
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
        >
          {onRetry && (
            <Button
              variant="primary"
              size={compact ? 'md' : 'lg'}
              fullWidth={!compact}
              onClick={onRetry}
              icon={<span>↻</span>}
            >
              {retryLabel}
            </Button>
          )}
          
          {secondaryAction && (
            <button
              className="error-action-secondary"
              onClick={secondaryAction.onClick}
            >
              {secondaryAction.label}
            </button>
          )}
        </motion.div>
      )}

      {/* Decorative gradient glow */}
      <div className="error-glow" aria-hidden="true" />
    </motion.div>
  );
});

ErrorState.displayName = 'ErrorState';

export default ErrorState;
