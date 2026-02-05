import { useCallback, type FC } from 'react';
import { motion } from 'framer-motion';
import './TokenSelector.css';

export interface Token {
  symbol: string;
  name: string;
  icon: string;
  decimals: number;
  mint?: string;
}

interface Props {
  tokens: Token[];
  selected: Token;
  onChange: (token: Token) => void;
  onMaxClick?: (balance: number) => void;
  balance?: number | null;
  disabled?: boolean;
}

export const SUPPORTED_TOKENS: Token[] = [
  { symbol: 'SOL', name: 'Solana (auto-wrap)', icon: '◎', decimals: 9 },
  { symbol: 'WSOL', name: 'Wrapped SOL', icon: '◎', decimals: 9, mint: 'So11111111111111111111111111111111111111112' },
];

const formatBalance = (bal: number): string => {
  if (bal === 0) return '0';
  if (bal < 0.001) return '<0.001';
  if (bal < 1) return bal.toFixed(4);
  if (bal < 1000) return bal.toFixed(2);
  return bal.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

export const TokenSelector: FC<Props> = ({
  tokens,
  selected,
  onChange,
  onMaxClick,
  balance,
  disabled = false,
}) => {
  const handleSelect = useCallback((token: Token) => {
    if (!disabled && token.symbol !== selected.symbol) {
      onChange(token);
    }
  }, [disabled, selected, onChange]);

  return (
    <div className="token-selector">
      <div className="token-tabs" role="radiogroup" aria-label="Select token">
        {tokens.map((token) => {
          const isSelected = token.symbol === selected.symbol;
          return (
            <button
              key={token.symbol}
              type="button"
              role="radio"
              aria-checked={isSelected}
              className={`token-tab${isSelected ? ' selected' : ''}`}
              onClick={() => handleSelect(token)}
              disabled={disabled}
            >
              {isSelected && (
                <motion.div
                  className="token-tab-bg"
                  layoutId="token-tab-indicator"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              <span className="token-tab-content">
                <span className="token-icon" aria-hidden="true">{token.icon}</span>
                <span className="token-symbol">{token.symbol}</span>
              </span>
            </button>
          );
        })}
      </div>

      {balance !== undefined && balance !== null && (
        <motion.div
          className="token-balance"
          key={selected.symbol}
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 5 }}
          transition={{ duration: 0.15 }}
        >
          <span className="balance-label">Balance:</span>
          <span className="balance-amount">
            {formatBalance(balance)} {selected.symbol}
          </span>
          {onMaxClick && balance > 0 && (
            <button
              type="button"
              className="max-button"
              onClick={() => onMaxClick(balance)}
              disabled={disabled}
              aria-label={`Use maximum balance of ${formatBalance(balance)} ${selected.symbol}`}
            >
              Max
            </button>
          )}
        </motion.div>
      )}
    </div>
  );
};

export default TokenSelector;
