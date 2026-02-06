import { memo, useState, useCallback, type FC, type ReactNode } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import './ConfirmationSummary.css';

interface FeeRow {
  label: string;
  value: string;
  /** Raw numeric value in SOL for total calculation */
  rawValue?: number;
  tooltip?: string;
}

interface Props {
  /** Amount being sent */
  amount: string;
  /** Token symbol */
  token: string;
  /** Token icon/emoji */
  tokenIcon?: string;
  /** Recipient identifier */
  recipient: string;
  /** Fee rows to display */
  fees?: FeeRow[];
  /** Custom action area */
  children?: ReactNode;
}

// Trigger haptic feedback
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
 * Venmo-style confirmation summary card.
 * This is the critical "are you sure?" screen before sending funds.
 *
 * Shows:
 * - Big centered amount with token icon + animated entrance
 * - Recipient badge with platform detection
 * - Fee breakdown with expandable tooltips
 * - Total line (amount + fees)
 * - Privacy assurance badge
 * - Irreversibility notice
 *
 * Design notes (from DESIGN.md):
 * - One action per screen — don't overwhelm
 * - Big, bold amounts — make the number the hero
 * - Trust through simplicity — fewer elements = more confidence
 */
export const ConfirmationSummary: FC<Props> = memo(({
  amount,
  token,
  tokenIcon = '◎',
  recipient,
  fees = [],
  children,
}) => {
  const [expandedTooltip, setExpandedTooltip] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();

  const toggleTooltip = useCallback((label: string) => {
    setExpandedTooltip(prev => prev === label ? null : label);
    triggerHaptic(6);
  }, []);

  // Detect platform from recipient handle for visual badge
  const recipientMeta = getRecipientMeta(recipient);

  // Calculate total if fees have raw values
  const totalAmount = parseFloat(amount) || 0;
  const totalFees = fees.reduce((sum, f) => sum + (f.rawValue ?? 0), 0);
  const showTotal = totalFees > 0 && token === 'SOL';

  return (
    <motion.div
      className="confirmation-summary"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      {/* Header glow effect */}
      <div className="confirmation-glow" aria-hidden="true" />

      {/* Main content */}
      <div className="confirmation-content">
        {/* Review label */}
        <motion.div
          className="confirmation-review-badge"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.05 }}
        >
          <span className="review-dot" aria-hidden="true" />
          <span>Review</span>
        </motion.div>

        {/* Amount section — the hero */}
        <motion.div
          className="confirmation-hero"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1, type: 'spring', stiffness: 300, damping: 25 }}
        >
          <div className="confirmation-amount-row">
            <motion.span
              className="confirmation-token-icon"
              initial={reducedMotion ? {} : { rotate: -15, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              transition={{ delay: 0.15, type: 'spring' }}
              aria-hidden="true"
            >
              {tokenIcon.startsWith('http') ? (
                <img
                  src={tokenIcon}
                  alt=""
                  width={24}
                  height={24}
                  loading="lazy"
                  decoding="async"
                  style={{ borderRadius: 6, verticalAlign: 'middle' }}
                />
              ) : (
                tokenIcon
              )}
            </motion.span>
            <motion.span
              className="confirmation-amount"
              initial={{ x: -10, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              {amount}
            </motion.span>
            <motion.span
              className="confirmation-token"
              initial={{ x: 10, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.25 }}
            >
              {token}
            </motion.span>
          </div>
        </motion.div>

        {/* Recipient section */}
        <motion.div
          className="confirmation-recipient"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <span className="recipient-label">to</span>
          <div className="recipient-badge" title={recipient}>
            <span className="recipient-icon" aria-hidden="true">
              {recipientMeta.icon}
            </span>
            {/* Friendly display: don’t show internal namespacing like `twitter:@` */}
            <span className="recipient-handle">{recipientMeta.shortName}</span>
            {recipientMeta.platform && (
              <span className="recipient-platform">{recipientMeta.platform}</span>
            )}
          </div>
        </motion.div>

        {/* Divider with animated entrance */}
        <motion.div
          className="confirmation-divider"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay: 0.35, duration: 0.3 }}
        />

        {/* Fee breakdown */}
        {fees.length > 0 && (
          <motion.div
            className="confirmation-fees"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
          >
            {/* Amount row */}
            <div className="fee-row">
              <span className="fee-label">Amount</span>
              <span className="fee-value">
                {amount} {token}
              </span>
            </div>

            {/* Fee rows */}
            {fees.map((fee, index) => (
              <div
                key={fee.label}
                className={`fee-row ${fee.tooltip ? 'has-tooltip' : ''}`}
                onClick={() => fee.tooltip && toggleTooltip(fee.label)}
                onKeyDown={(e) => {
                  if (fee.tooltip && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    toggleTooltip(fee.label);
                  }
                }}
                role={fee.tooltip ? 'button' : undefined}
                tabIndex={fee.tooltip ? 0 : undefined}
                aria-expanded={fee.tooltip ? expandedTooltip === fee.label : undefined}
              >
                <span className="fee-label">
                  {fee.label}
                  {fee.tooltip && (
                    <motion.span
                      className={`fee-info ${expandedTooltip === fee.label ? 'active' : ''}`}
                      whileHover={!reducedMotion ? { scale: 1.15 } : undefined}
                      aria-label="More info"
                    >
                      ⓘ
                    </motion.span>
                  )}
                </span>
                <motion.span
                  className="fee-value fee-value-muted"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.45 + index * 0.05 }}
                >
                  {fee.value}
                </motion.span>

                {/* Tooltip expansion */}
                <AnimatePresence>
                  {fee.tooltip && expandedTooltip === fee.label && (
                    <motion.div
                      className="fee-tooltip"
                      initial={{ opacity: 0, height: 0, marginTop: 0 }}
                      animate={{ opacity: 1, height: 'auto', marginTop: 8 }}
                      exit={{ opacity: 0, height: 0, marginTop: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <p>{fee.tooltip}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}

            {/* Total row */}
            {showTotal && (
              <motion.div
                className="fee-row fee-total"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
              >
                <span className="fee-label">Total</span>
                <span className="fee-value fee-value-total">
                  ~{(totalAmount + totalFees).toFixed(6)} {token}
                </span>
              </motion.div>
            )}
          </motion.div>
        )}

        {/* Privacy badge */}
        <motion.div
          className="confirmation-privacy"
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          <span className="privacy-icon" aria-hidden="true">🔒</span>
          <span className="privacy-text">
            Private transfer — only {recipientMeta.shortName} can claim
          </span>
        </motion.div>

        {/* Irreversibility notice */}
        <motion.p
          className="confirmation-notice"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.55 }}
        >
          This transfer cannot be reversed after sending
        </motion.p>
      </div>

      {/* Action area (children) */}
      {children && (
        <motion.div
          className="confirmation-actions"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
        >
          {children}
        </motion.div>
      )}
    </motion.div>
  );
});

ConfirmationSummary.displayName = 'ConfirmationSummary';

// ─── Helpers ──────────────────────────────────────────────────

interface RecipientMeta {
  icon: string;
  platform: string | null;
  shortName: string;
}

/**
 * Detect recipient platform from handle for visual display.
 * Handles namespaced identifiers: twitter:@user, discord:user, email:user@x.com
 * Returns appropriate icon, platform label, and short name.
 */
function getRecipientMeta(recipient: string): RecipientMeta {
  const trimmed = recipient.trim();

  // ── Namespaced identifiers (from provider pills) ──

  // Twitter / X: twitter:@handle
  if (trimmed.toLowerCase().startsWith('twitter:')) {
    const handle = trimmed.slice('twitter:'.length);
    return {
      icon: '𝕏',
      platform: 'X',
      shortName: handle.startsWith('@') ? handle : `@${handle}`,
    };
  }

  // Discord: discord:username
  if (trimmed.toLowerCase().startsWith('discord:')) {
    return {
      icon: '🎮',
      platform: 'Discord',
      shortName: trimmed.slice('discord:'.length),
    };
  }

  // Email: email:user@example.com
  if (trimmed.toLowerCase().startsWith('email:')) {
    const addr = trimmed.slice('email:'.length);
    return {
      icon: '📧',
      platform: 'Email',
      shortName: addr.split('@')[0] || addr,
    };
  }

  // ── Legacy / bare identifiers ──

  // Discord: user#1234
  if (trimmed.includes('#')) {
    return {
      icon: '🎮',
      platform: 'Discord',
      shortName: trimmed.split('#')[0],
    };
  }

  // Twitter / X: @handle (bare, no namespace)
  if (trimmed.startsWith('@')) {
    return {
      icon: '𝕏',
      platform: 'X',
      shortName: trimmed,
    };
  }

  // Email: contains @ and . (bare, no namespace)
  if (trimmed.includes('@') && trimmed.includes('.')) {
    return {
      icon: '📧',
      platform: 'Email',
      shortName: trimmed.split('@')[0],
    };
  }

  // Solana address (32+ chars, base58)
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed)) {
    return {
      icon: 'https://assets.coingecko.com/coins/images/4128/standard/solana.png?1718769756',
      platform: 'Solana',
      shortName: `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`,
    };
  }

  // Default: generic user
  return {
    icon: '👤',
    platform: null,
    shortName: trimmed.split(':').pop()?.split('@')[0] || trimmed,
  };
}

export default ConfirmationSummary;
