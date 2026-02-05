import { memo, type FC } from 'react';
import { motion } from 'framer-motion';
import { Button } from './Button';
import { timeAgo } from '../lib/timeAgo';
import './DepositCard.css';

interface Deposit {
  id: string;
  amount: number;
  token: string;
  leafIndex: number;
  timestamp: string;
  claimed: boolean;
}

interface Props {
  deposit: Deposit;
  index: number;
  onClaim: (deposit: Deposit) => void;
  disabled?: boolean;
}

// Token icon mapping — Venmo shows app-specific icons per payment type
const TOKEN_ICONS: Record<string, { icon: string; color: string }> = {
  SOL: { icon: '◎', color: '#9945FF' },
  WSOL: { icon: '◎', color: '#14F195' },
};

const DEFAULT_TOKEN = { icon: '🪙', color: '#f59e0b' };

/**
 * Venmo-inspired deposit card.
 *
 * Each deposit is a mini "transaction" in the feed:
 * - Token-aware icon with colored accent ring
 * - Bold amount as hero element
 * - Relative timestamp ("2 hours ago")
 * - Unclaimed deposits glow to draw attention
 * - Claimed deposits are visually muted
 * - Staggered entrance animation
 */
export const DepositCard: FC<Props> = memo(({ deposit, index, onClaim, disabled }) => {
  const tokenInfo = TOKEN_ICONS[deposit.token] || DEFAULT_TOKEN;
  const isClaimed = deposit.claimed;

  return (
    <motion.div
      className={`deposit-card-v2 ${isClaimed ? 'claimed' : 'unclaimed'}`}
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        delay: index * 0.06,
        duration: 0.3,
        ease: [0.25, 0.46, 0.45, 0.94], // easeOutQuad
      }}
      layout
    >
      {/* Unclaimed glow accent */}
      {!isClaimed && (
        <div
          className="deposit-glow"
          style={{ '--glow-color': tokenInfo.color } as React.CSSProperties}
          aria-hidden="true"
        />
      )}

      <div className="deposit-card-inner">
        {/* Token icon with accent ring */}
        <div
          className={`deposit-token-icon ${isClaimed ? '' : 'active'}`}
          style={{ '--token-color': tokenInfo.color } as React.CSSProperties}
        >
          <span className="token-symbol">{tokenInfo.icon}</span>
          {!isClaimed && <div className="token-pulse" aria-hidden="true" />}
        </div>

        {/* Details */}
        <div className="deposit-info">
          <div className="deposit-amount-row">
            <span className="deposit-amount-v2">
              {deposit.amount} {deposit.token}
            </span>
            {isClaimed && (
              <span className="deposit-claimed-tag">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
                </svg>
                Claimed
              </span>
            )}
          </div>
          <span className="deposit-time">{timeAgo(deposit.timestamp)}</span>
        </div>

        {/* Action */}
        <div className="deposit-action">
          {isClaimed ? (
            <div className="deposit-done-icon" aria-label="Already claimed">
              <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
                <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
              </svg>
            </div>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={() => onClaim(deposit)}
              disabled={disabled}
              className="deposit-claim-btn"
            >
              Claim
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  );
});

DepositCard.displayName = 'DepositCard';

export default DepositCard;
