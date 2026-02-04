import { useState, useEffect, useCallback, memo, type FC } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import './BalanceDisplay.css';

interface Props {
  /** Show full balance card or compact inline version */
  variant?: 'card' | 'inline';
  /** Optional click handler (e.g., to set max amount) */
  onClick?: (balance: number) => void;
  /** Show refresh button */
  showRefresh?: boolean;
  /** Custom class name */
  className?: string;
}

// Format balance with appropriate precision
const formatBalance = (lamports: number): string => {
  const sol = lamports / LAMPORTS_PER_SOL;
  
  if (sol === 0) return '0';
  if (sol < 0.001) return '<0.001';
  if (sol < 1) return sol.toFixed(4);
  if (sol < 100) return sol.toFixed(3);
  if (sol < 10000) return sol.toFixed(2);
  
  // Large numbers: use compact notation
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(sol);
};

// Format for screen readers
const formatBalanceAccessible = (lamports: number): string => {
  const sol = lamports / LAMPORTS_PER_SOL;
  return `${sol.toFixed(4)} SOL`;
};

/**
 * Venmo-style wallet balance display.
 * 
 * Features:
 * - Real-time balance updates
 * - Animated value changes (count up effect)
 * - Click to use max balance
 * - Refresh button with spin animation
 * - Loading skeleton state
 * - Compact or full card variants
 */
export const BalanceDisplay: FC<Props> = memo(({
  variant = 'card',
  onClick,
  showRefresh = true,
  className = '',
}) => {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const reducedMotion = useReducedMotion();
  
  const [balance, setBalance] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prevBalance, setPrevBalance] = useState<number | null>(null);

  // Fetch balance
  const fetchBalance = useCallback(async (isManualRefresh = false) => {
    if (!publicKey || !connection) return;

    if (isManualRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const lamports = await connection.getBalance(publicKey);
      setPrevBalance(balance);
      setBalance(lamports);
    } catch (e) {
      console.error('Failed to fetch balance:', e);
      setError('Failed to load');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [publicKey, connection, balance]);

  // Initial fetch and subscribe to changes
  useEffect(() => {
    if (!publicKey || !connection) {
      setBalance(null);
      setPrevBalance(null);
      return;
    }

    fetchBalance();

    // Subscribe to balance changes
    const subscriptionId = connection.onAccountChange(
      publicKey,
      (accountInfo) => {
        setPrevBalance(balance);
        setBalance(accountInfo.lamports);
      },
      'confirmed'
    );

    return () => {
      connection.removeAccountChangeListener(subscriptionId);
    };
  }, [publicKey, connection]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle click to use max
  const handleClick = useCallback(() => {
    if (onClick && balance !== null) {
      // Leave some SOL for fees (0.01 SOL)
      const maxUsable = Math.max(0, balance - 0.01 * LAMPORTS_PER_SOL);
      onClick(maxUsable / LAMPORTS_PER_SOL);
    }
  }, [onClick, balance]);

  // Handle refresh
  const handleRefresh = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isRefreshing) {
      fetchBalance(true);
    }
  }, [fetchBalance, isRefreshing]);

  // Detect balance change direction for animation
  const balanceDirection = 
    balance !== null && prevBalance !== null
      ? balance > prevBalance ? 'up' : balance < prevBalance ? 'down' : null
      : null;

  // Not connected state
  if (!connected) {
    if (variant === 'inline') return null;
    
    return (
      <div className={`balance-display ${variant} not-connected ${className}`}>
        <span className="balance-placeholder">Connect wallet to see balance</span>
      </div>
    );
  }

  // Inline variant
  if (variant === 'inline') {
    return (
      <motion.button
        className={`balance-display inline ${onClick ? 'clickable' : ''} ${className}`}
        onClick={onClick ? handleClick : undefined}
        disabled={!onClick || balance === null}
        whileTap={onClick ? { scale: 0.98 } : undefined}
        title={balance !== null ? `Use max: ${formatBalanceAccessible(balance)}` : undefined}
      >
        <span className="balance-label">Balance:</span>
        <AnimatePresence mode="wait">
          {isLoading ? (
            <motion.span 
              key="loading" 
              className="balance-skeleton"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
          ) : error ? (
            <motion.span 
              key="error" 
              className="balance-error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              —
            </motion.span>
          ) : (
            <motion.span
              key={balance}
              className={`balance-value ${balanceDirection || ''}`}
              initial={reducedMotion ? {} : { opacity: 0, y: balanceDirection === 'up' ? 10 : -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <span className="balance-symbol">◎</span>
              {balance !== null ? formatBalance(balance) : '—'}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
    );
  }

  // Card variant
  return (
    <motion.div
      className={`balance-display card ${onClick ? 'clickable' : ''} ${className}`}
      onClick={onClick ? handleClick : undefined}
      whileHover={onClick ? { scale: 1.01 } : undefined}
      whileTap={onClick ? { scale: 0.99 } : undefined}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      role={onClick ? 'button' : undefined}
      aria-label={balance !== null ? `Wallet balance: ${formatBalanceAccessible(balance)}. ${onClick ? 'Click to use maximum amount.' : ''}` : 'Loading balance'}
    >
      {/* Header row */}
      <div className="balance-header">
        <span className="balance-title">
          <span className="balance-icon">💰</span>
          Your Balance
        </span>
        
        {showRefresh && (
          <motion.button
            className={`balance-refresh ${isRefreshing ? 'spinning' : ''}`}
            onClick={handleRefresh}
            disabled={isRefreshing}
            whileTap={{ scale: 0.9 }}
            aria-label="Refresh balance"
            title="Refresh balance"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 11-2.636-6.364" strokeLinecap="round" />
              <path d="M21 3v5h-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </motion.button>
        )}
      </div>

      {/* Main balance */}
      <div className="balance-main">
        <AnimatePresence mode="wait">
          {isLoading ? (
            <motion.div 
              key="loading" 
              className="balance-skeleton-large"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
          ) : error ? (
            <motion.div 
              key="error" 
              className="balance-error-card"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <span className="error-icon">⚠️</span>
              <span className="error-text">{error}</span>
              <button className="error-retry" onClick={() => fetchBalance()}>
                Retry
              </button>
            </motion.div>
          ) : (
            <motion.div
              key={`balance-${balance}`}
              className={`balance-amount ${balanceDirection || ''}`}
              initial={reducedMotion ? {} : { 
                opacity: 0, 
                y: balanceDirection === 'up' ? 20 : balanceDirection === 'down' ? -20 : 0,
                scale: 0.95,
              }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            >
              <span className="amount-symbol">◎</span>
              <span className="amount-value">
                {balance !== null ? formatBalance(balance) : '—'}
              </span>
              <span className="amount-currency">SOL</span>
            </motion.div>
          )}
        </AnimatePresence>
        
        {/* Balance change indicator */}
        <AnimatePresence>
          {balanceDirection && !reducedMotion && (
            <motion.div
              className={`balance-change ${balanceDirection}`}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.3 }}
            >
              {balanceDirection === 'up' ? '↑' : '↓'}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Use max hint */}
      {onClick && balance !== null && balance > 0 && (
        <motion.p 
          className="balance-hint"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          Tap to use max
        </motion.p>
      )}
    </motion.div>
  );
});

BalanceDisplay.displayName = 'BalanceDisplay';

export default BalanceDisplay;
