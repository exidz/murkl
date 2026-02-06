import { useState, useRef, useEffect, useCallback, type FC } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { Button } from './Button';
import { OtpInput } from './OtpInput';
import { sendEmailOTP, verifyEmailOTP } from '../lib/auth-client';
import { formatTokenAmount } from '../lib/format';

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
  onPasswordSubmit: (password: string) => void | Promise<void>;
  onSwitchToOAuth: () => void;
}

// ─── Count-up animation hook ─────────────────────────────────
// Animates a number from 0 to target with easeOut. Used for the hero amount
// so receiving money feels exciting — like Venmo's "you got paid" moment.

function useCountUp(target: number, duration = 1200, delay = 400): string {
  const [display, setDisplay] = useState('0');
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!target || reducedMotion) {
      setDisplay(formatTokenAmount(target || 0, { maxDecimals: 6 }));
      return;
    }

    // Determine decimal places from the target value.
    // Note: JS number → string already trims trailing zeros (e.g. 1.5000 → "1.5"),
    // which is what we want for a clean Venmo-style readout.
    const decimalsRaw = String(target).includes('.') ? String(target).split('.')[1].length : 0;
    const decimals = Math.min(decimalsRaw, 6);

    let rafId: number;
    let startTime: number;

    const delayTimer = setTimeout(() => {
      const animate = (timestamp: number) => {
        if (!startTime) startTime = timestamp;
        const elapsed = timestamp - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // easeOutCubic — fast start, satisfying settle
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = eased * target;

        setDisplay(formatTokenAmount(current, { maxDecimals: decimals }));

        if (progress < 1) {
          rafId = requestAnimationFrame(animate);
        }
      };

      rafId = requestAnimationFrame(animate);
    }, delay);

    return () => {
      clearTimeout(delayTimer);
      cancelAnimationFrame(rafId);
    };
  }, [target, duration, delay, reducedMotion]);

  return display;
}

// ─── Provider detection helpers ──────────────────────────────

interface IdentifierMeta {
  icon: string;
  displayName: string;
  providerLabel: string | null;
}

function getIdentifierMeta(identifier: string): IdentifierMeta {
  if (identifier.startsWith('email:')) {
    return {
      icon: '✉️',
      displayName: identifier.slice('email:'.length),
      providerLabel: 'Email',
    };
  }
  if (identifier.startsWith('twitter:')) {
    const handle = identifier.slice('twitter:'.length);
    return {
      icon: '𝕏',
      displayName: handle.startsWith('@') ? handle : `@${handle}`,
      providerLabel: 'X',
    };
  }
  if (identifier.startsWith('discord:')) {
    return {
      icon: '🎮',
      displayName: identifier.slice('discord:'.length),
      providerLabel: 'Discord',
    };
  }
  return { icon: '👤', displayName: identifier, providerLabel: null };
}

// ─── Floating particles (ambient depth, like SplashScreen) ───

const LANDING_PARTICLES = Array.from({ length: 5 }, (_, i) => ({
  id: i,
  x: 20 + Math.random() * 60,
  y: 10 + Math.random() * 40,
  size: 2 + Math.random() * 2.5,
  delay: Math.random() * 2,
  duration: 3 + Math.random() * 3,
}));

// ─── Stagger variants ────────────────────────────────────────

const heroContainerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.05,
    },
  },
};

const heroItemVariants = {
  hidden: { opacity: 0, y: 15, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: 'spring' as const, stiffness: 300, damping: 24 },
  },
};

/**
 * Claim Link Landing — Venmo-style "You received" hero screen.
 *
 * This is the FIRST thing a recipient sees when they click a claim link.
 * Must feel exciting, trustworthy, and premium.
 *
 * Features:
 * - Animated count-up for the amount (like getting paid!)
 * - Ambient floating particles + glow for depth
 * - Pulse ring on the hero icon
 * - Shimmer gradient on the amount text
 * - Staggered entrance animation
 * - Platform-aware recipient badge with provider icon
 * - Email OTP verification for email identifiers
 * - Respects reduced motion
 *
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
  const [submitting, setSubmitting] = useState(false);
  const { setVisible: openWalletModal } = useWalletModal();
  const inputRef = useRef<HTMLInputElement>(null);
  const reducedMotion = useReducedMotion();

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

  // Animated count-up for the amount
  const animatedAmount = useCountUp(data.amount || 0, 1200, 500);

  // Identifier display info
  const identifierMeta = getIdentifierMeta(data.identifier);

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
      // UX: short resend cooldown (most apps use ~30–90s). Server should still rate-limit.
      setCooldown(60);
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

  const handleSubmit = useCallback(async () => {
    if (!isReady || !connected || submitting) return;
    setSubmitting(true);
    try {
      await onPasswordSubmit(password);
    } finally {
      // Parent will usually transition immediately into the proving screen.
      // If something fails and we stay here, re-enable the button.
      setSubmitting(false);
    }
  }, [isReady, connected, submitting, onPasswordSubmit, password]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && isReady && connected && !submitting) {
      e.preventDefault();
      handleSubmit();
    }
  }, [isReady, connected, submitting, handleSubmit]);

  // Format cooldown for display
  const formatCooldown = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}:${sec.toString().padStart(2, '0')}` : `${sec}s`;
  };

  // Whether we need email verification before showing password
  const needsEmailVerification = isEmailIdentifier && !emailVerified;

  const tokenSymbol = data.token || 'SOL';

  return (
    <motion.div
      className="claim-landing"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Ambient background glow — premium depth effect */}
      <div className="landing-ambient-glow" aria-hidden="true" />

      {/* Floating particles — subtle depth like SplashScreen */}
      {!reducedMotion && (
        <div className="landing-particles" aria-hidden="true">
          {LANDING_PARTICLES.map(p => (
            <motion.div
              key={p.id}
              className="landing-particle"
              style={{
                left: `${p.x}%`,
                top: `${p.y}%`,
                width: p.size,
                height: p.size,
              }}
              animate={{
                y: [0, -15, 0],
                opacity: [0.1, 0.35, 0.1],
              }}
              transition={{
                duration: p.duration,
                delay: p.delay,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            />
          ))}
        </div>
      )}

      {/* Hero section — staggered entrance */}
      <motion.div
        className="landing-hero"
        variants={heroContainerVariants}
        initial="hidden"
        animate="visible"
      >
        {/* Icon with pulse ring */}
        <motion.div
          className="landing-icon"
          variants={heroItemVariants}
        >
          <span>💰</span>
          {/* Pulse ring (like success-check) */}
          {!reducedMotion && <div className="landing-icon-pulse" aria-hidden="true" />}
        </motion.div>

        {/* Title — contextual based on whether amount is known */}
        <motion.h2
          className="landing-title"
          variants={heroItemVariants}
        >
          {data.amount
            ? 'You received'
            : 'Funds waiting for you'}
        </motion.h2>

        {/* Big amount with count-up + shimmer */}
        {data.amount != null && data.amount > 0 && (
          <motion.div
            className="landing-amount"
            variants={heroItemVariants}
          >
            <span className="landing-amount-value">{animatedAmount}</span>
            <span className="landing-amount-token">{tokenSymbol}</span>
          </motion.div>
        )}

        {/* Recipient badge with provider-aware icon */}
        <motion.div
          className="landing-recipient"
          variants={heroItemVariants}
        >
          <span className="landing-recipient-icon">
            {identifierMeta.icon}
          </span>
          <span className="landing-recipient-name">{identifierMeta.displayName}</span>
          {identifierMeta.providerLabel && (
            <span className="landing-recipient-platform">
              {identifierMeta.providerLabel}
            </span>
          )}
          {emailVerified && (
            <span className="landing-verified-badge">✓ verified</span>
          )}
        </motion.div>
      </motion.div>

      {/* Action section (sticky on mobile) */}
      <div className="landing-action-surface">
        <motion.div
          className="landing-action"
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
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
                  We’ll email a 6‑digit code to <strong>{emailAddress}</strong>
                </p>
                <Button
                  variant="primary"
                  size="lg"
                  fullWidth
                  onClick={handleSendOtp}
                  loading={sendingOtp}
                  loadingText="Sending..."
                  disabled={cooldown > 0}
                  icon={<span>✉️</span>}
                >
                  {cooldown > 0 ? `Resend in ${formatCooldown(cooldown)}` : 'Send code'}
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
                  Enter the 6‑digit code we sent to <strong>{emailAddress}</strong>
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
            <p className="landing-password-label">Enter the secret code</p>

            <div className="landing-password-wrapper">
              <input
                ref={inputRef}
                type={showPassword ? 'text' : 'password'}
                className={`landing-password-input ${password.length > 0 ? 'has-value' : ''} ${isReady ? 'ready' : ''}`}
                placeholder="Secret code from the sender…"
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
                aria-label={showPassword ? 'Hide code' : 'Show code'}
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
                <span className="ready-text">✓ Ready</span>
              ) : (
                <span>{password.length}/8 characters minimum</span>
              )}
            </motion.div>

            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={handleSubmit}
              disabled={!isReady || !wasmReady || submitting}
              loading={submitting}
              loadingText="Claiming..."
            >
              Claim
            </Button>

            {!wasmReady && (
              <div className="landing-wasm-loading" role="status" aria-live="polite">
                <span className="landing-inline-spinner" aria-hidden="true" />
                <span>Getting things ready…</span>
              </div>
            )}
          </div>
        )}
        </motion.div>
      </div>

      {/* Trust indicators — like SplashScreen badges */}
      <motion.div
        className="landing-trust"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.55 }}
      >
        <div className="landing-trust-item">
          <span className="landing-trust-icon">🔒</span>
          <span className="landing-trust-label">Private</span>
        </div>
        <span className="landing-trust-divider" aria-hidden="true">•</span>
        <div className="landing-trust-item">
          <span className="landing-trust-icon">🛡️</span>
          <span className="landing-trust-label">Secure</span>
        </div>
        <span className="landing-trust-divider" aria-hidden="true">•</span>
        <div className="landing-trust-item">
          <span className="landing-trust-icon">⚡</span>
          <span className="landing-trust-label">Instant</span>
        </div>
      </motion.div>

      {/* Privacy footer */}
      <motion.div
        className="landing-privacy"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
      >
        <span className="landing-privacy-icon">🔒</span>
        <span>
          {isEmailIdentifier
            ? 'Email verification + secret code required to claim'
            : 'Only someone with the secret code can claim'}
        </span>
      </motion.div>

      {/* Switch to OAuth */}
      <motion.button
        className="landing-switch"
        onClick={onSwitchToOAuth}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.65 }}
      >
        Sign in to see all deposits →
      </motion.button>
    </motion.div>
  );
};

export default ClaimLanding;
