import { useCallback, type FC, type Key } from 'react';
import { Tabs, Tab } from '@heroui/react';
import { motion, AnimatePresence } from 'framer-motion';
import './TokenSelector.css';

export interface Token {
  symbol: string;
  name: string;
  icon: string;
  decimals: number;
  mint?: string; // Solana mint address
}

interface Props {
  tokens: Token[];
  selected: Token;
  onChange: (token: Token) => void;
  onMaxClick?: (balance: number) => void; // Callback when Max is clicked
  balance?: number | null;
  disabled?: boolean;
}

// Default supported tokens
export const SUPPORTED_TOKENS: Token[] = [
  { symbol: 'SOL', name: 'Solana (auto-wrap)', icon: '◎', decimals: 9 },
  { symbol: 'WSOL', name: 'Wrapped SOL', icon: '◎', decimals: 9, mint: 'So11111111111111111111111111111111111111112' },
];

/**
 * Token selector using HeroUI Tabs.
 * Shows balance underneath selected token.
 */
export const TokenSelector: FC<Props> = ({
  tokens,
  selected,
  onChange,
  onMaxClick,
  balance,
  disabled = false,
}) => {
  // Handle tab selection change
  const handleSelectionChange = useCallback((key: Key) => {
    const token = tokens.find(t => t.symbol === String(key));
    if (token) {
      onChange(token);
    }
  }, [tokens, onChange]);

  // Format balance display
  const formatBalance = (bal: number): string => {
    if (bal === 0) return '0';
    if (bal < 0.001) return '<0.001';
    if (bal < 1) return bal.toFixed(4);
    if (bal < 1000) return bal.toFixed(2);
    return bal.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  return (
    <div className="token-selector">
      {/* HeroUI Tabs for token selection */}
      <Tabs
        selectedKey={selected.symbol}
        onSelectionChange={handleSelectionChange}
        variant="bordered"
        size="md"
        isDisabled={disabled}
        aria-label="Select token"
        classNames={{
          base: 'token-tabs-base',
          tabList: 'token-tabs-list',
          tab: 'token-tab-item',
          cursor: 'token-tab-cursor',
          tabContent: 'token-tab-content',
        }}
      >
        {tokens.map((token) => (
          <Tab
            key={token.symbol}
            title={
              <div className="token-tab-title">
                <span className="token-icon" aria-hidden="true">{token.icon}</span>
                <span className="token-symbol">{token.symbol}</span>
              </div>
            }
          />
        ))}
      </Tabs>

      {/* Balance display with Max button */}
      <AnimatePresence mode="wait">
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
              <motion.button
                type="button"
                className="max-button"
                onClick={() => onMaxClick(balance)}
                disabled={disabled}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                aria-label={`Use maximum balance of ${formatBalance(balance)} ${selected.symbol}`}
              >
                Max
              </motion.button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default TokenSelector;
