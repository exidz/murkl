import { memo, useState, type FC, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import './ConfirmationSummary.css';

interface FeeRow {
  label: string;
  value: string;
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

/**
 * Venmo-style confirmation summary card.
 * Shows the final review before sending with:
 * - Big centered amount with token icon
 * - Recipient badge
 * - Fee breakdown with optional tooltips
 * - Animated entrance for visual impact
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
        {/* Amount section - the hero */}
        <motion.div 
          className="confirmation-hero"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1, type: 'spring', stiffness: 300, damping: 25 }}
        >
          <span className="confirmation-label">You're sending</span>
          
          <div className="confirmation-amount-row">
            <motion.span 
              className="confirmation-token-icon"
              initial={{ rotate: -15, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              transition={{ delay: 0.15, type: 'spring' }}
            >
              {tokenIcon}
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
          <div className="recipient-badge">
            <span className="recipient-icon">👤</span>
            <span className="recipient-handle">{recipient}</span>
          </div>
        </motion.div>

        {/* Divider with shine effect */}
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
            {fees.map((fee, index) => (
              <div 
                key={fee.label} 
                className="fee-row"
                onClick={() => fee.tooltip && setExpandedTooltip(
                  expandedTooltip === fee.label ? null : fee.label
                )}
              >
                <span className="fee-label">
                  {fee.label}
                  {fee.tooltip && (
                    <motion.span 
                      className="fee-info"
                      whileHover={{ scale: 1.1 }}
                      aria-label="More info"
                    >
                      ⓘ
                    </motion.span>
                  )}
                </span>
                <motion.span 
                  className="fee-value"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.45 + index * 0.05 }}
                >
                  {fee.value}
                </motion.span>
                
                {/* Tooltip expansion */}
                <AnimatePresence>
                  {fee.tooltip && expandedTooltip === fee.label && (
                    <motion.p
                      className="fee-tooltip"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                    >
                      {fee.tooltip}
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </motion.div>
        )}

        {/* Privacy badge */}
        <motion.div 
          className="confirmation-privacy"
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          <span className="privacy-icon">🔒</span>
          <span className="privacy-text">
            Transfer is private — only {recipient.split('@')[0] || recipient} can claim
          </span>
        </motion.div>
      </div>

      {/* Action area (children) */}
      {children && (
        <motion.div 
          className="confirmation-actions"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55 }}
        >
          {children}
        </motion.div>
      )}
    </motion.div>
  );
});

ConfirmationSummary.displayName = 'ConfirmationSummary';

export default ConfirmationSummary;
