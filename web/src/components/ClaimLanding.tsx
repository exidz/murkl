import { useState, useRef, useEffect, useCallback, type FC } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { Button } from './Button';
import { OtpInput } from './OtpInput';
import { sendEmailOTP, verifyEmailOTP } from '../lib/auth-client';

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
 * For email identifiers: requires OTP verification before password entry.
 * For social identifiers: goes directly to password entry.
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

  // Email OTP verification state
  const isEmailIdentifier = data.identifier.startsWith('email:');
  const emailAddress = isEmailIdentifier ? data.identifier.slice('email:'.length) : '';
  const [emailVerified, setEmailVerified] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState<string | null>(null);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // Cooldown timer for resend
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown(c => c - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // Focus inputs on state changes
  useEffect(() => {
    if (connected && (emailVerified || !isEmailIdentifier)) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [connected, emailVerified, isEmailIdentifier]);

  // Send OTP
  const handleSendOtp = useCallback(async () => {
    if (cooldown > 0) return;
    setSendingOtp(true);
    setOtpError(null);
    try {
      await sendEmailOTP(emailAddress);
      setOtpSent(true);
      setCooldown(300); // 5 minute cooldown
    } catch {
      setOtpError('Failed to send code. Try again.');
    } finally {
      setSendingOtp(false);
    }
  }, [emailAddress, cooldown]);

  // Verify OTP
  const handleVerifyOtp = useCallback(async () => {
    if (otp.length < 6) return;
    setVerifyingOtp(true);
    setOtpError(null);
    try {
      const result = await verifyEmailOTP(emailAddress, otp);
      if (result.error) {
        setOtpError('Invalid or expired code.');
      } else {
        setEmailVerified(true);
      }
    } catch {
      setOtpError('Verification failed. Try again.');
    } finally {
      setVerifyingOtp(false);
    }
  }, [emailAddress, otp]);

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
  const displayName = data.identifier.startsWith('email:')
    ? data.identifier.slice('email:'.length)
    : data.identifier.startsWith('twitter:')
      ? data.identifier.slice('twitter:'.length)
      : data.identifier.startsWith('discord:')
        ? data.identifier.slice('discord:'.length)
        : data.identifier;

  // Format cooldown for display
  const formatCooldown = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}:${sec.toString().padStart(2, '0')}` : `${sec}s`;
  };

  // Whether we need email verification before showing password
  const needsEmailVerification = isEmailIdentifier && !emailVerified;

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
          <span className="landing-recipient-icon">
            {isEmailIdentifier ? '✉️' : '👤'}
          </span>
          <span className="landing-recipient-name">{displayName}</span>
          {emailVerified && (
            <span className="landing-verified-badge">✓ verified</span>
          )}
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
        ) : needsEmailVerification ? (
          /* Email OTP verification step */
          <AnimatePresence mode="wait">
            {!otpSent ? (
              <motion.div
                key="send-otp"
                className="landing-email-verify"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <p className="landing-email-hint">
                  Verify you own <strong>{emailAddress}</strong> to claim
                </p>
                <Button
                  variant="primary"
                  size="lg"
                  fullWidth
                  onClick={handleSendOtp}
                  loading={sendingOtp}
                  loadingText="Sending..."
                  icon={<span>✉️</span>}
                >
                  Send verification code
                </Button>
                {otpError && (
                  <p className="landing-otp-error">{otpError}</p>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="verify-otp"
                className="landing-email-verify"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <p className="landing-email-hint">
                  Enter the code sent to <strong>{emailAddress}</strong>
                </p>
                <OtpInput
                  value={otp}
                  onChange={setOtp}
                  onComplete={handleVerifyOtp}
                  length={6}
                  size="lg"
                  autoFocus
                />
                {otpError && (
                  <p className="landing-otp-error">{otpError}</p>
                )}
                <Button
                  variant="primary"
                  size="lg"
                  fullWidth
                  onClick={handleVerifyOtp}
                  loading={verifyingOtp}
                  loadingText="Verifying..."
                  disabled={otp.length < 6}
                >
                  Verify
                </Button>
                <div className="landing-otp-actions">
                  <button
                    className="landing-otp-resend"
                    onClick={handleSendOtp}
                    disabled={cooldown > 0 || sendingOtp}
                  >
                    {cooldown > 0 ? `Resend in ${formatCooldown(cooldown)}` : 'Resend code'}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        ) : (
          /* Password entry (shown after email verified or for non-email identifiers) */
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
        <span>
          {isEmailIdentifier
            ? 'Email verification + password required to claim'
            : 'Only someone with the password can claim'}
        </span>
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
