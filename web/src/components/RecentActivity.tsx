import { memo, useState, useCallback, type FC } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { RecentSend } from '../hooks/useRecentSends';
import { timeAgo } from '../lib/timeAgo';
import { getExplorerUrl } from '../lib/constants';
import toast from './Toast';
import './RecentActivity.css';

interface Props {
  /** Recent sends to display */
  sends: RecentSend[];
  /** Callback to clear all history */
  onClear?: () => void;
}

// Map provider prefix to icon
const PROVIDER_ICONS: Record<string, string> = {
  'twitter:': '𝕏',
  'discord:': '🎮',
  'email:': '✉️',
};

function getProviderIcon(recipient: string): string {
  for (const [prefix, icon] of Object.entries(PROVIDER_ICONS)) {
    if (recipient.startsWith(prefix)) return icon;
  }
  return '👤';
}

/** Strip the provider prefix for display */
function formatRecipient(recipient: string): string {
  for (const prefix of Object.keys(PROVIDER_ICONS)) {
    if (recipient.startsWith(prefix)) {
      return recipient.slice(prefix.length);
    }
  }
  return recipient;
}

// Stagger animation config
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 8, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: 'spring' as const, stiffness: 350, damping: 28 },
  },
};

/**
 * Venmo-style recent activity feed for the Send tab.
 *
 * Shows the user's last few sends with:
 * - Recipient icon + handle
 * - Amount + token
 * - Relative timestamp ("2 hours ago")
 * - Tap to view transaction on explorer
 *
 * Design notes (from DESIGN.md):
 * - Friendly, not clinical — "Your recent sends"
 * - Trust through simplicity — clean card list
 * - Mobile-first, touch-friendly
 */
export const RecentActivity: FC<Props> = memo(({ sends, onClear }) => {
  const [showConfirmClear, setShowConfirmClear] = useState(false);

  const handleCopy = useCallback(async (shareLink: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(shareLink);
      toast.success('Link copied!');
    } catch {
      toast.error('Failed to copy');
    }
  }, []);

  const handleClear = useCallback(() => {
    if (!showConfirmClear) {
      setShowConfirmClear(true);
      // Auto-dismiss after 3s
      setTimeout(() => setShowConfirmClear(false), 3000);
      return;
    }
    onClear?.();
    setShowConfirmClear(false);
  }, [showConfirmClear, onClear]);

  if (sends.length === 0) return null;

  return (
    <motion.div
      className="recent-activity"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2, duration: 0.3 }}
    >
      {/* Section header */}
      <div className="recent-header">
        <h3 className="recent-title">
          <span className="recent-title-icon" aria-hidden="true">📝</span>
          Recent sends
        </h3>
        {onClear && (
          <button
            className={`recent-clear ${showConfirmClear ? 'confirming' : ''}`}
            onClick={handleClear}
            aria-label={showConfirmClear ? 'Confirm clear history' : 'Clear history'}
          >
            {showConfirmClear ? 'Confirm?' : 'Clear'}
          </button>
        )}
      </div>

      {/* Transaction list */}
      <motion.div
        className="recent-list"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        role="list"
        aria-label="Recent transactions"
      >
        <AnimatePresence initial={false}>
          {sends.map((send) => (
            <motion.a
              key={send.id}
              className="recent-item"
              href={getExplorerUrl(send.signature)}
              target="_blank"
              rel="noopener noreferrer"
              variants={itemVariants}
              layout
              role="listitem"
              aria-label={`Sent ${send.amount} ${send.token} to ${formatRecipient(send.recipient)}`}
            >
              {/* Provider icon */}
              <div className="recent-item-icon" aria-hidden="true">
                <span>{getProviderIcon(send.recipient)}</span>
              </div>

              {/* Details */}
              <div className="recent-item-info">
                <div className="recent-item-top">
                  <span className="recent-item-recipient">
                    {formatRecipient(send.recipient)}
                  </span>
                  <span className="recent-item-amount">
                    -{send.amount} {send.token}
                  </span>
                </div>
                <span className="recent-item-time">
                  {timeAgo(send.timestamp)}
                </span>
              </div>

              {/* Quick re-share button */}
              <button
                className="recent-item-share"
                onClick={(e) => handleCopy(send.shareLink, e)}
                aria-label="Copy claim link"
                title="Copy claim link"
              >
                🔗
              </button>
            </motion.a>
          ))}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
});

RecentActivity.displayName = 'RecentActivity';

export default RecentActivity;
