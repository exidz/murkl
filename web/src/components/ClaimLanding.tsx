import { useState, useRef, useEffect, type FC } from 'react';
import { motion } from 'framer-motion';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { Button } from './Button';

/** Data extracted from a claim link URL */
export interface ClaimLinkData {
  identifier: string;
  leafIndex: number;
  pool: string;
  /** Amount if we could fetch it from the relayer */
  amount?: number;
  /** Token symbol if known */
  token?: string;
}

interface Props {
  data: ClaimLinkData;
  wasmReady: boolean;
  connected: boolean;
  onPasswordSubmit: (password: string) => void;
  onSwitchToOAuth: () => void;
}

/**
 * Claim Link Landing — Venmo-style "You received" hero screen.
 * Shown when user arrives via a claim link (?id=...&leaf=...).
 * Skips OAuth and goes directly to password entry → proof → claim.
 */
export const ClaimLanding: FC<Props> = ({
  data,
  wasmReady,
  connected,
  onPasswordSubmit,
  onSwitchToOAuth,
}) => {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const { setVisible: openWalletModal } = useWalletModal();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (connected) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [connected]);

  const isReady = password.length >= 8;

  const handleSubmit = () => {
    if (!isReady || !connected) return;
    onPasswordSubmit(password);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && isReady && connected) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Friendly display of the identifier
  const displayName = data.identifier.startsWith('@')
    ? data.identifier
    : data.identifier.includes('@')
      ? data.identifier.split('@')[0]
      : data.identifier;

  return (
    <motion.div
      className="claim-landing"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Hero section */}
      <div className="landing-hero">
        <motion.div
          className="landing-icon"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.1 }}
        >
          💰
        </motion.div>

        <motion.h2
          className="landing-title"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          {data.amount
            ? `${data.amount} ${data.token || 'SOL'} waiting`
            : 'Funds waiting for you'}
        </motion.h2>

        <motion.div
          className="landing-recipient"
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <span className="landing-recipient-icon">👤</span>
          <span className="landing-recipient-name">{displayName}</span>
        </motion.div>

        {data.amount && (
          <motion.div
            className="landing-amount"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.25, type: 'spring', stiffness: 200 }}
          >
            <span className="landing-amount-value">{data.amount}</span>
            <span className="landing-amount-token">{data.token || 'SOL'}</span>
          </motion.div>
        )}
      </div>

      {/* Action section */}
      <motion.div
        className="landing-action"
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        {!connected ? (
          /* Wallet not connected */
          <div className="landing-connect">
            <p className="landing-connect-hint">Connect your wallet to claim</p>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={() => openWalletModal(true)}
              icon={<span>👛</span>}
            >
              Connect Wallet
            </Button>
          </div>
        ) : (
          /* Password entry */
          <div className="landing-password">
            <p className="landing-password-label">Enter the password to claim</p>

            <div className="landing-password-wrapper">
              <input
                ref={inputRef}
                type={showPassword ? 'text' : 'password'}
                className={`landing-password-input ${password.length > 0 ? 'has-value' : ''} ${isReady ? 'ready' : ''}`}
                placeholder="Password from sender..."
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                autoComplete="off"
                spellCheck={false}
              />
              <motion.button
                type="button"
                className="landing-password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                whileTap={{ scale: 0.9 }}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? '🙈' : '👁️'}
              </motion.button>
            </div>

            <motion.div
              className={`landing-password-hint ${isReady ? 'ready' : ''}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              {password.length === 0 ? (
                <span>The sender shared this with you</span>
              ) : isReady ? (
                <span className="ready-text">✓ Ready to claim</span>
              ) : (
                <span>{password.length}/8 characters minimum</span>
              )}
            </motion.div>

            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={handleSubmit}
              disabled={!isReady || !wasmReady}
              loading={!wasmReady}
              loadingText="Loading prover..."
            >
              Claim
            </Button>
          </div>
        )}
      </motion.div>

      {/* Privacy footer */}
      <motion.div
        className="landing-privacy"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
      >
        <span className="landing-privacy-icon">🔒</span>
        <span>Only someone with the password can claim</span>
      </motion.div>

      {/* Switch to OAuth */}
      <motion.button
        className="landing-switch"
        onClick={onSwitchToOAuth}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
      >
        Sign in to see all deposits →
      </motion.button>
    </motion.div>
  );
};

export default ClaimLanding;
