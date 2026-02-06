import { type FC, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Button } from './Button';
import './EmptyState.css';

type IllustrationKey = 'inbox' | 'wallet' | 'send' | 'lock' | 'success' | 'search';

interface Props {
  /** Pre-built illustration type */
  illustration?: IllustrationKey;
  /** Custom emoji/icon (overrides illustration) */
  icon?: ReactNode;
  /** Main heading */
  title: string;
  /** Supporting description */
  description?: string;
  /**
   * Primary action button — baseline-ui requires every empty state
   * to have at least one clear next action.
   */
  action?: {
    label: string;
    onClick: () => void;
  };
  /** Secondary action (subtle link-style) */
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  /** Compact mode for inline usage */
  compact?: boolean;
}

// Animated SVG illustrations (simple, friendly)
const illustrations: Record<IllustrationKey, ReactNode> = {
  inbox: (
    <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <motion.rect
        x="15" y="20" width="50" height="40" rx="4"
        stroke="currentColor" strokeWidth="2" fill="none"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
      />
      <motion.path
        d="M15 30 L40 45 L65 30"
        stroke="currentColor" strokeWidth="2" fill="none"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.6, delay: 0.3, ease: "easeOut" }}
      />
      <motion.circle
        cx="55" cy="25" r="8"
        fill="var(--accent-primary)" opacity="0.2"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.5, type: "spring" }}
      />
    </svg>
  ),
  wallet: (
    <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <motion.rect
        x="12" y="24" width="50" height="36" rx="4"
        stroke="currentColor" strokeWidth="2" fill="none"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
      />
      <motion.rect
        x="52" y="36" width="16" height="12" rx="2"
        stroke="currentColor" strokeWidth="2" fill="none"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.4, ease: "easeOut" }}
      />
      <motion.circle
        cx="58" cy="42" r="2"
        fill="var(--accent-success)"
        initial={{ scale: 0 }}
        animate={{ scale: [0, 1.2, 1] }}
        transition={{ delay: 0.6, duration: 0.3 }}
      />
    </svg>
  ),
  send: (
    <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <motion.path
        d="M20 40 L55 25 L55 55 Z"
        stroke="currentColor" strokeWidth="2" fill="none" strokeLinejoin="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      />
      <motion.line
        x1="55" y1="40" x2="68" y2="40"
        stroke="var(--accent-primary)" strokeWidth="2" strokeLinecap="round"
        initial={{ pathLength: 0, x1: 55 }}
        animate={{ pathLength: 1, x1: [55, 52, 55] }}
        transition={{ 
          pathLength: { duration: 0.4, delay: 0.3 },
          x1: { duration: 1, delay: 0.7, repeat: Infinity, ease: "easeInOut" }
        }}
      />
    </svg>
  ),
  lock: (
    <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <motion.rect
        x="24" y="36" width="32" height="28" rx="4"
        stroke="currentColor" strokeWidth="2" fill="none"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      />
      <motion.path
        d="M30 36 V28 C30 20 50 20 50 28 V36"
        stroke="currentColor" strokeWidth="2" fill="none"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.5, delay: 0.3, ease: "easeOut" }}
      />
      <motion.circle
        cx="40" cy="48" r="3"
        fill="var(--accent-primary)"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.6, type: "spring" }}
      />
    </svg>
  ),
  success: (
    <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <motion.circle
        cx="40" cy="40" r="28"
        stroke="var(--accent-success)" strokeWidth="2" fill="none"
        initial={{ pathLength: 0, scale: 0.8, opacity: 0 }}
        animate={{ pathLength: 1, scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      />
      <motion.path
        d="M28 42 L36 50 L54 32"
        stroke="var(--accent-success)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.4, delay: 0.3, ease: "easeOut" }}
      />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <motion.circle
        cx="35" cy="35" r="18"
        stroke="currentColor" strokeWidth="2" fill="none"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      />
      <motion.line
        x1="48" y1="48" x2="60" y2="60"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.3, delay: 0.4, ease: "easeOut" }}
      />
      <motion.line
        x1="28" y1="35" x2="42" y2="35"
        stroke="var(--accent-primary)" strokeWidth="2" strokeLinecap="round" opacity="0.5"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.3, delay: 0.6, ease: "easeOut" }}
      />
    </svg>
  ),
};

/**
 * Venmo-style empty state with friendly animations.
 * Use for:
 * - No deposits yet
 * - Wallet not connected
 * - Search with no results
 * - Post-action success states
 */
export const EmptyState: FC<Props> = ({
  illustration,
  icon,
  title,
  description,
  action,
  secondaryAction,
  compact = false,
}) => {
  const displayIcon = icon || (illustration ? illustrations[illustration] : null);

  // Warn in dev if no action is provided — baseline-ui requires a next action
  if (process.env.NODE_ENV === 'development' && !action && !secondaryAction) {
    console.warn(
      '[EmptyState] baseline-ui: empty states should have at least one clear next action. ' +
      `Empty state "${title}" has no action prop.`
    );
  }

  return (
    <motion.div 
      className={`empty-state ${compact ? 'compact' : ''}`}
      role="status"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Illustration / Icon (decorative) */}
      {displayIcon && (
        <motion.div 
          className="empty-illustration"
          aria-hidden="true"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.3 }}
        >
          {displayIcon}
        </motion.div>
      )}

      {/* Text content */}
      <div className="empty-content">
        <motion.h3 
          className="empty-title"
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          {title}
        </motion.h3>
        
        {description && (
          <motion.p 
            className="empty-description"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            {description}
          </motion.p>
        )}
      </div>

      {/* Actions — baseline-ui: empty states MUST have one clear next action */}
      {(action || secondaryAction) && (
        <motion.div 
          className="empty-actions"
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
        >
          {action && (
            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={() => action.onClick()}
            >
              {action.label}
            </Button>
          )}

          {secondaryAction && (
            <Button
              variant="ghost"
              size="md"
              fullWidth
              onClick={() => secondaryAction.onClick()}
              className="empty-secondary"
            >
              {secondaryAction.label}
            </Button>
          )}
        </motion.div>
      )}
    </motion.div>
  );
};

export default EmptyState;
