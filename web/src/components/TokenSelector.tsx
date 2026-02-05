import { useCallback, type FC, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
  // Keep UI copy friendly: explain any technical details via helper text, not token names.
  { symbol: 'SOL', name: 'Solana', icon: '◎', decimals: 9 },
  { symbol: 'WSOL', name: 'Wrapped SOL', icon: '◎', decimals: 9, mint: 'So11111111111111111111111111111111111111112' },
];

const formatBalance = (bal: number): string => {
  if (bal === 0) return '0';
  if (bal < 0.001) return '<0.001';
  if (bal < 1) return bal.toFixed(4);
  if (bal < 1000) return bal.toFixed(2);
  return bal.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

const formatTokenName = (token: Token): string => {
  // Keep names friendly and non-technical in the UI.
  if (token.symbol === 'SOL') return 'Solana';
  if (token.symbol === 'WSOL') return 'Wrapped SOL';
  return token.name;
};

export const TokenSelector: FC<Props> = ({
  tokens,
  selected,
  onChange,
  onMaxClick,
  balance,
  disabled = false,
}) => {
  const handleSelect = useCallback(
    (token: Token) => {
      if (!disabled && token.symbol !== selected.symbol) {
        onChange(token);
      }
    },
    [disabled, selected.symbol, onChange],
  );

  const showBalanceRow = balance !== undefined;
  const isBalanceLoading = balance === null;

  const selectedLabel = useMemo(() => formatTokenName(selected), [selected]);

  const helperText = useMemo(() => {
    if (selected.symbol === 'SOL') return `We'll handle wrapping for you.`;
    if (selected.symbol === 'WSOL') return `Uses the wrapped SOL in your wallet.`;
    return '';
  }, [selected.symbol]);

  return (
    <div className="token-selector">
      <div className="token-tabs" role="radiogroup" aria-label="Select token">
        {tokens.map((token) => {
          const isSelected = token.symbol === selected.symbol;
          const tokenLabel = formatTokenName(token);

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
                <span className="token-icon" aria-hidden="true">
                  {token.icon}
                </span>
                <span className="token-symbol">{token.symbol}</span>
              </span>
              <span className="token-tab-sub" aria-hidden="true">
                {tokenLabel}
              </span>
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {helperText && (
          <motion.p
            key={selected.symbol}
            className="token-help"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
          >
            <span className="token-help-label">Using</span>{' '}
            <span className="token-help-value">{selectedLabel}</span>
            <span className="token-help-sep">·</span>
            <span className="token-help-text">{helperText}</span>
          </motion.p>
        )}
      </AnimatePresence>

      {showBalanceRow && (
        <motion.div
          className="token-balance"
          key={selected.symbol}
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 5 }}
          transition={{ duration: 0.15 }}
        >
          <span className="balance-label">Balance</span>

          {isBalanceLoading ? (
            <span className="balance-skeleton" aria-label="Checking balance" />
          ) : (
            <span className="balance-amount">
              {formatBalance(balance as number)} {selected.symbol}
            </span>
          )}

          {onMaxClick && !isBalanceLoading && (balance as number) > 0 && (
            <button
              type="button"
              className="max-button"
              onClick={() => onMaxClick(balance as number)}
              disabled={disabled}
              aria-label={`Use maximum balance of ${formatBalance(balance as number)} ${selected.symbol}`}
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
