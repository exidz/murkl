import { memo, useCallback, type FC } from 'react';
import { motion } from 'framer-motion';
import './InlineBalancePill.css';

interface Props {
  tokenSymbol: string;
  tokenIcon?: string;
  /** null = loading; number = balance */
  balance: number | null;
  onUseMax?: (balance: number) => void;
  className?: string;
}

const format = (bal: number): string => {
  if (bal === 0) return '0';
  if (bal < 0.001) return '<0.001';
  if (bal < 1) return bal.toFixed(4);
  if (bal < 1000) return bal.toFixed(2);
  return bal.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

/**
 * Venmo-style inline balance pill.
 * Keeps the amount step calm: one line of context + optional "Use max" action.
 */
export const InlineBalancePill: FC<Props> = memo(({
  tokenSymbol,
  tokenIcon = '◎',
  balance,
  onUseMax,
  className = '',
}) => {
  const canUseMax = typeof balance === 'number' && balance > 0 && !!onUseMax;

  const handleUseMax = useCallback(() => {
    if (typeof balance === 'number' && onUseMax) onUseMax(balance);
  }, [balance, onUseMax]);

  return (
    <div className={`inline-balance ${className}`.trim()}>
      <div className="inline-balance-left" aria-label={`Balance in ${tokenSymbol}`}>
        <span className="inline-balance-label">Balance</span>

        {balance === null ? (
          <span className="inline-balance-skeleton" aria-label="Checking balance" />
        ) : (
          <span className="inline-balance-value">
            <span className="inline-balance-icon" aria-hidden="true">{tokenIcon}</span>
            {format(balance)} <span className="inline-balance-symbol">{tokenSymbol}</span>
          </span>
        )}
      </div>

      {canUseMax && (
        <motion.button
          type="button"
          className="inline-balance-max"
          onClick={handleUseMax}
          whileTap={{ scale: 0.98 }}
          aria-label={`Use max balance (${format(balance as number)} ${tokenSymbol})`}
        >
          Use max
        </motion.button>
      )}
    </div>
  );
});

InlineBalancePill.displayName = 'InlineBalancePill';

export default InlineBalancePill;
