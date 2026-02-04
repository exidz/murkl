import { useState, useCallback, useRef, useEffect, type FC } from 'react';
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
 * Venmo-style token selector with pill buttons.
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
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };

    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showDropdown]);

  // Handle token selection
  const handleSelect = useCallback((token: Token) => {
    onChange(token);
    setShowDropdown(false);
  }, [onChange]);

  // Format balance display
  const formatBalance = (bal: number): string => {
    if (bal === 0) return '0';
    if (bal < 0.001) return '<0.001';
    if (bal < 1) return bal.toFixed(4);
    if (bal < 1000) return bal.toFixed(2);
    return bal.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  return (
    <div className="token-selector" ref={dropdownRef}>
      {/* Token pills */}
      <div className="token-pills" role="radiogroup" aria-label="Select token">
        {tokens.map((token) => {
          const isSelected = token.symbol === selected.symbol;
          
          return (
            <motion.button
              key={token.symbol}
              type="button"
              className={`token-pill ${isSelected ? 'selected' : ''}`}
              onClick={() => handleSelect(token)}
              disabled={disabled}
              role="radio"
              aria-checked={isSelected}
              whileTap={{ scale: 0.97 }}
            >
              <span className="token-icon" aria-hidden="true">{token.icon}</span>
              <span className="token-symbol">{token.symbol}</span>
              
              {/* Selection indicator */}
              {isSelected && (
                <motion.div
                  className="pill-indicator"
                  layoutId="tokenIndicator"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
            </motion.button>
          );
        })}
      </div>

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

      {/* Dropdown for more tokens (if needed) */}
      <AnimatePresence>
        {showDropdown && tokens.length > 4 && (
          <motion.div
            className="token-dropdown"
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
          >
            {tokens.map((token) => (
              <button
                key={token.symbol}
                type="button"
                className={`dropdown-item ${token.symbol === selected.symbol ? 'selected' : ''}`}
                onClick={() => handleSelect(token)}
              >
                <span className="dropdown-icon">{token.icon}</span>
                <div className="dropdown-info">
                  <span className="dropdown-symbol">{token.symbol}</span>
                  <span className="dropdown-name">{token.name}</span>
                </div>
                {token.symbol === selected.symbol && (
                  <span className="dropdown-check">✓</span>
                )}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default TokenSelector;
