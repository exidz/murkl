import { useState, useRef, useEffect, useCallback, type FC } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { Button } from './Button';
import { RELAYER_URL } from '../lib/constants';
import './VoucherClaim.css';

interface VoucherInfo {
  code: string;
  amount: number;
  token: string;
  claimed: boolean;
}

interface VoucherRedeemResult {
  success: boolean;
  identifier: string;
  leafIndex: number;
  pool: string;
  amount: number;
  token: string;
}

interface Props {
  /** Pre-filled voucher code from URL */
  initialCode?: string;
  /** Called when voucher is successfully redeemed with password */
  onRedeem: (data: {
    identifier: string;
    leafIndex: number;
    pool: string;
    password: string;
    amount: number;
    token: string;
    voucherCode: string;
  }) => void;
  /** Called when user wants to switch to OAuth login */
  onSwitchToOAuth: () => void;
  /** Whether WASM prover is ready */
  wasmReady: boolean;
}

/**
 * Voucher code redemption flow for email recipients.
 * 
 * UX Flow:
 * 1. Enter voucher code (or auto-filled from URL)
 * 2. Fetch voucher info (shows amount, checks if claimed)
 * 3. Enter password to decrypt
 * 4. On success, passes claim data to parent
 * 
 * No OTP needed — receiving the email IS the verification.
 */
export const VoucherClaim: FC<Props> = ({
  initialCode = '',
  onRedeem,
  onSwitchToOAuth,
  wasmReady,
}) => {
  const { connected } = useWallet();
  const { setVisible: openWalletModal } = useWalletModal();
  const reducedMotion = useReducedMotion();

  // State
  const [code, setCode] = useState(initialCode);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [step, setStep] = useState<'code' | 'password'>('code');
  const [voucherInfo, setVoucherInfo] = useState<VoucherInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs
  const codeInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus on mount or step change
  useEffect(() => {
    if (step === 'code') {
      codeInputRef.current?.focus();
    } else if (step === 'password') {
      passwordInputRef.current?.focus();
    }
  }, [step]);

  // Auto-fetch voucher info if code is pre-filled
  useEffect(() => {
    if (initialCode && initialCode.length >= 8) {
      handleLookupVoucher(initialCode);
    }
  }, [initialCode]);

  // Lookup voucher info (amount, claimed status)
  const handleLookupVoucher = useCallback(async (voucherCode?: string) => {
    const lookupCode = voucherCode || code;
    if (lookupCode.length < 8) {
      setError('Code must be at least 8 characters');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${RELAYER_URL}/vouchers/${encodeURIComponent(lookupCode)}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Invalid voucher code');
        return;
      }

      if (data.claimed) {
        setError('This voucher has already been claimed');
        return;
      }

      setVoucherInfo(data);
      setStep('password');
    } catch {
      setError('Failed to verify code. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [code]);

  // Redeem voucher with password
  const handleRedeem = useCallback(async () => {
    if (!voucherInfo || password.length < 8) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${RELAYER_URL}/vouchers/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: voucherInfo.code, password }),
      });

      const data = await res.json() as VoucherRedeemResult & { error?: string };

      if (!res.ok) {
        setError(data.error || 'Incorrect password');
        return;
      }

      // Success! Pass claim data to parent
      onRedeem({
        identifier: data.identifier,
        leafIndex: data.leafIndex,
        pool: data.pool,
        password,
        amount: data.amount,
        token: data.token,
        voucherCode: voucherInfo.code,
      });
    } catch {
      setError('Failed to redeem. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [voucherInfo, password, onRedeem]);

  // Handle key press
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (step === 'code') {
        handleLookupVoucher();
      } else if (step === 'password' && password.length >= 8) {
        handleRedeem();
      }
    }
  }, [step, handleLookupVoucher, handleRedeem, password.length]);

  // Format code input (uppercase, strip invalid chars)
  const handleCodeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    // Keep alphanumeric only, preserve case
    const cleaned = e.target.value.replace(/[^a-zA-Z0-9]/g, '');
    setCode(cleaned);
    setError(null);
  }, []);

  return (
    <div className="voucher-claim">
      <AnimatePresence mode="wait">
        {step === 'code' ? (
          <motion.div
            key="code-step"
            className="voucher-step"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: reducedMotion ? 0.1 : 0.2 }}
          >
            <div className="voucher-header">
              <span className="voucher-icon">🎟️</span>
              <h2>Enter claim code</h2>
              <p>Check your email for the code</p>
            </div>

            <div className="voucher-input-wrapper">
              <input
                ref={codeInputRef}
                type="text"
                className={`voucher-code-input ${error ? 'error' : ''} ${code.length >= 8 ? 'valid' : ''}`}
                placeholder="ABC123XYZ..."
                value={code}
                onChange={handleCodeChange}
                onKeyDown={handleKeyDown}
                maxLength={20}
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="characters"
              />
              {code.length > 0 && (
                <motion.span
                  className="voucher-code-count"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  {code.length}/12
                </motion.span>
              )}
            </div>

            {error && (
              <motion.p
                className="voucher-error"
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
              >
                {error}
              </motion.p>
            )}

            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={() => handleLookupVoucher()}
              loading={loading}
              loadingText="Verifying..."
              disabled={code.length < 8}
            >
              Continue
            </Button>
          </motion.div>
        ) : (
          <motion.div
            key="password-step"
            className="voucher-step"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: reducedMotion ? 0.1 : 0.2 }}
          >
            <button className="voucher-back" onClick={() => { setStep('code'); setError(null); }}>
              ← Back
            </button>

            {voucherInfo && (
              <motion.div
                className="voucher-preview"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
              >
                <span className="voucher-preview-icon">💰</span>
                <p className="voucher-preview-amount">
                  {voucherInfo.amount} {voucherInfo.token}
                </p>
                <p className="voucher-preview-label">waiting for you</p>
              </motion.div>
            )}

            <div className="voucher-password-section">
              <p className="voucher-password-label">
                Enter the password to claim
              </p>

              <div className="voucher-password-wrapper">
                <input
                  ref={passwordInputRef}
                  type={showPassword ? 'text' : 'password'}
                  className={`voucher-password-input ${error ? 'error' : ''} ${password.length >= 8 ? 'valid' : ''}`}
                  placeholder="Password from sender..."
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(null); }}
                  onKeyDown={handleKeyDown}
                  maxLength={128}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="voucher-password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? '🙈' : '👁️'}
                </button>
              </div>

              {error && (
                <motion.p
                  className="voucher-error"
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  {error}
                </motion.p>
              )}

              <p className="voucher-password-hint">
                {password.length === 0
                  ? 'The sender shared this with you'
                  : password.length < 8
                  ? `${password.length}/8 characters minimum`
                  : '✓ Ready to claim'}
              </p>
            </div>

            {!connected ? (
              <Button
                variant="primary"
                size="lg"
                fullWidth
                onClick={() => openWalletModal(true)}
                icon={<span>👛</span>}
              >
                Connect Wallet
              </Button>
            ) : (
              <Button
                variant="primary"
                size="lg"
                fullWidth
                onClick={handleRedeem}
                loading={loading}
                loadingText="Claiming..."
                disabled={password.length < 8 || !wasmReady}
              >
                {wasmReady ? 'Claim' : 'Loading prover...'}
              </Button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Trust badges */}
      <motion.div
        className="voucher-trust"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        <div className="voucher-trust-item">
          <span>🔒</span>
          <span>Private</span>
        </div>
        <span className="voucher-trust-divider">•</span>
        <div className="voucher-trust-item">
          <span>⚡</span>
          <span>No OTP needed</span>
        </div>
      </motion.div>

      {/* Switch to OAuth */}
      <motion.button
        className="voucher-switch"
        onClick={onSwitchToOAuth}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
      >
        Sign in to see all deposits →
      </motion.button>
    </div>
  );
};

export default VoucherClaim;
