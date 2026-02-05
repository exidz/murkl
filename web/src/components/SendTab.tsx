import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { FC } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import toast from './Toast';
import { buildDepositTransaction, generatePassword, createShareLink } from '../lib/deposit';
import { isValidIdentifier, isValidPassword, isValidAmount, sanitizeInput } from '../lib/validation';
import { POOL_ADDRESS, getExplorerUrl } from '../lib/constants';
import { HowItWorks } from './HowItWorks';
import { AmountInput, type AmountInputHandle } from './AmountInput';
import { AmountPresets } from './AmountPresets';
import { TokenSelector, SUPPORTED_TOKENS, type Token } from './TokenSelector';
import { Confetti } from './Confetti';
import { EmptyState } from './EmptyState';
import { Button } from './Button';
import { ConfirmationSummary } from './ConfirmationSummary';
import { ShareSheet } from './ShareSheet';
import { BalanceDisplay } from './BalanceDisplay';
import { StepProgress } from './StepProgress';
import { useTokenBalance } from '../hooks/useTokenBalance';
import { useRegisterDeposit } from '../hooks/useRegisterDeposit';
import { useRecentSends } from '../hooks/useRecentSends';
import { RecentSendsSheet } from './RecentSendsSheet';
import './SendTab.css';

// Token-specific preset amounts
const TOKEN_PRESETS: Record<string, { value: number; label: string }[]> = {
  SOL: [
    { value: 0.1, label: '0.1' },
    { value: 0.5, label: '0.5' },
    { value: 1, label: '1' },
    { value: 5, label: '5' },
  ],
  WSOL: [
    { value: 0.1, label: '0.1' },
    { value: 0.5, label: '0.5' },
    { value: 1, label: '1' },
    { value: 5, label: '5' },
  ],
};

interface Props {
  wasmReady: boolean;
}

interface DepositSuccess {
  signature: string;
  leafIndex: number;
  shareLink: string;
  password: string;
  identifier: string;
  amount: number;
  token: string;
}

type Step = 'amount' | 'recipient' | 'password' | 'confirm' | 'success';

function formatRecipient(identifier: string): string {
  if (identifier.startsWith('twitter:@')) return `@${identifier.slice('twitter:@'.length)}`;
  if (identifier.startsWith('discord:')) return identifier.slice('discord:'.length);
  if (identifier.startsWith('email:')) return identifier.slice('email:'.length);
  return identifier;
}

// Step definitions for progress indicator (excludes 'success' — that's a result, not a step)
const SEND_STEPS = [
  { id: 'amount', label: 'Amount' },
  { id: 'recipient', label: 'To' },
  { id: 'password', label: 'Password' },
  { id: 'confirm', label: 'Review' },
] as const;

// Direction-aware step transitions — slides in from right when going forward,
// from left when going back. Matches Venmo's natural navigation feel.
const stepVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 40 : -40,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
    transition: {
      x: { type: 'spring' as const, stiffness: 400, damping: 35 },
      opacity: { duration: 0.2 },
    },
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -40 : 40,
    opacity: 0,
    transition: {
      x: { type: 'spring' as const, stiffness: 400, damping: 35 },
      opacity: { duration: 0.15 },
    },
  }),
};

/**
 * Password strength score (0-4).
 * Simple entropy-based calculation — not a security library,
 * just enough for UX feedback.
 */
function getPasswordStrength(pw: string): { score: number; label: string; color: string } {
  if (!pw) return { score: 0, label: '', color: 'transparent' };
  
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  
  // Cap at 4 for the bar
  score = Math.min(4, score);
  
  const levels = [
    { label: 'Weak', color: 'var(--accent-error, #ef4444)' },
    { label: 'Fair', color: 'var(--accent-warning, #f59e0b)' },
    { label: 'Good', color: 'var(--accent-primary, #3d95ce)' },
    { label: 'Strong', color: 'var(--accent-success, #22c55e)' },
    { label: 'Excellent', color: 'var(--accent-success, #22c55e)' },
  ];
  
  return { score, ...levels[score] };
}

const SOCIAL_PROVIDERS = [
  {
    id: 'twitter',
    label: '𝕏',
    name: 'X',
    prefix: 'twitter:@',
    displayPrefix: '@',
    placeholder: 'username',
    example: '@yourname',
  },
  {
    id: 'discord',
    label: '💬',
    name: 'Discord',
    prefix: 'discord:',
    displayPrefix: '',
    placeholder: 'username',
    example: 'sable',
  },
  {
    id: 'email',
    label: '✉️',
    name: 'Email',
    prefix: 'email:',
    displayPrefix: '',
    placeholder: 'you@example.com',
    example: 'you@example.com',
  },
] as const;

type SocialProvider = typeof SOCIAL_PROVIDERS[number]['id'];

function getProvider(providerId: SocialProvider) {
  return SOCIAL_PROVIDERS.find((p) => p.id === providerId)!;
}

function formatDraftRecipient(providerId: SocialProvider, raw: string): string {
  const clean = sanitizeInput(raw);
  if (!clean) return '';
  // Friendly display in the UI (don’t show internal namespacing like `twitter:@`)
  if (providerId === 'twitter') return `@${clean.replace(/^@+/, '')}`;
  return clean;
}

export const SendTab: FC<Props> = ({ wasmReady }) => {
  const { connected, publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const reducedMotion = useReducedMotion();

  // Form state
  const [amount, setAmount] = useState('');
  const [selectedToken, setSelectedToken] = useState<Token>(SUPPORTED_TOKENS[0]);
  const [identifier, setIdentifier] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<SocialProvider>('twitter');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<Step>('amount');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<DepositSuccess | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [showShareSheet, setShowShareSheet] = useState(false);
  const [showRecentSheet, setShowRecentSheet] = useState(false);
  
  // Direction tracking for step transitions (1 = forward, -1 = backward)
  const [stepDirection, setStepDirection] = useState(1);
  const [isRegenerating, setIsRegenerating] = useState(false);

  // TanStack Query: token balance & deposit registration
  const { data: tokenBalance = null } = useTokenBalance(selectedToken.symbol);
  const registerDeposit = useRegisterDeposit();
  
  // Recent sends history (persisted in localStorage)
  const { sends: recentSends, addSend: addRecentSend, clearSends: clearRecentSends } = useRecentSends();
  
  // Refs
  const amountInputRef = useRef<AmountInputHandle>(null);
  const identifierInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  // Password strength for visual indicator
  const passwordStrength = useMemo(() => getPasswordStrength(password), [password]);

  // Focus input on step change (AmountInput handles its own focus)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (step === 'recipient') identifierInputRef.current?.focus();
      if (step === 'password') passwordInputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, [step]);

  // Auto-generate password on mount
  useEffect(() => {
    if (!password) {
      setPassword(generatePassword(16));
    }
  }, []);

  // Token balance is now handled by useTokenBalance hook (TanStack Query)

  // Handle token change
  const handleTokenChange = useCallback((token: Token) => {
    setSelectedToken(token);
    // Reset amount when switching tokens
    setAmount('');
  }, []);

  // Handle Max button click - fills in max balance (minus buffer for fees + rent)
  const handleMaxClick = useCallback((balance: number) => {
    // Reserve for: tx fees (~0.000005) + WSOL account rent (~0.002) + wallet rent-exempt (~0.001)
    const feeBuffer = selectedToken.symbol === 'SOL' ? 0.005 : 0;
    const maxAmount = Math.max(0, balance - feeBuffer);
    
    // Format to avoid floating point issues, respect token decimals
    const formatted = maxAmount.toFixed(Math.min(selectedToken.decimals, 6));
    // Remove trailing zeros after decimal
    const cleaned = formatted.replace(/\.?0+$/, '');
    
    setAmount(cleaned || '0');
  }, [selectedToken]);

  // Copy to clipboard
  const copyToClipboard = useCallback(async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      toast.success(`Copied!`);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  }, []);

  // Handle amount change (AmountInput handles validation)
  const handleAmountChange = useCallback((value: string) => {
    setAmount(value);
  }, []);

  // Navigation — tracks direction for slide animation
  const goNext = useCallback(() => {
    if (step === 'amount') {
      if (!isValidAmount(amount)) {
        amountInputRef.current?.shake();
        toast.error('Enter a valid amount');
        return;
      }
      setStepDirection(1);
      setStep('recipient');
    } else if (step === 'recipient') {
      if (!isValidIdentifier(identifier)) {
        toast.error('Enter a valid recipient');
        return;
      }
      setStepDirection(1);
      setStep('password');
    } else if (step === 'password') {
      if (!isValidPassword(password)) {
        toast.error('Password must be 8-128 characters');
        return;
      }
      setStepDirection(1);
      setStep('confirm');
    }
  }, [step, amount, identifier, password]);

  const goBack = useCallback(() => {
    setStepDirection(-1);
    if (step === 'recipient') setStep('amount');
    else if (step === 'password') setStep('recipient');
    else if (step === 'confirm') setStep('password');
  }, [step]);

  // Regenerate password with spin animation
  const handleRegenerate = useCallback(() => {
    setIsRegenerating(true);
    setPassword(generatePassword(16));
    // Reset spin after animation duration
    setTimeout(() => setIsRegenerating(false), 500);
  }, []);

  // Handle key press for navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      goNext();
    }
  }, [goNext]);

  // Handle deposit
  const handleDeposit = useCallback(async () => {
    if (!connected || !publicKey || !signTransaction) {
      toast.error('Please connect your wallet');
      return;
    }
    
    setLoading(true);
    
    try {
      // Build namespaced identifier: <provider>:<handle>
      const provider = getProvider(selectedProvider);
      const fullIdentifier = `${provider.prefix}${sanitizeInput(identifier)}`;
      const amountNum = parseFloat(amount);
      
      // Validate user keeps enough SOL for rent + fees when depositing native SOL
      if (selectedToken.symbol === 'SOL') {
        const solBalance = await connection.getBalance(publicKey);
        const solBalanceNum = solBalance / 1e9;
        const minReserve = 0.005; // rent-exempt + fees + WSOL rent
        if (solBalanceNum - amountNum < minReserve) {
          toast.error(`Keep at least ${minReserve} SOL for fees. Max: ${(solBalanceNum - minReserve).toFixed(4)} SOL`);
          return;
        }
      }
      
      // Build transaction
      // If user selected SOL, wrap native SOL to WSOL
      // If user selected WSOL, use existing WSOL directly
      const wrapSol = selectedToken.symbol === 'SOL';
      const depositResult = await buildDepositTransaction(
        connection,
        POOL_ADDRESS,
        publicKey,
        fullIdentifier,
        password,
        amountNum,
        { wrapSol },
      );
      
      // Get blockhash right before signing
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      depositResult.transaction.recentBlockhash = blockhash;
      depositResult.transaction.feePayer = publicKey;
      
      // Sign transaction
      const txToastId = toast.loading('Approve in wallet...');
      const signed = await signTransaction(depositResult.transaction);
      toast.update(txToastId, { message: 'Sending...', type: 'loading' });
      
      // Send with retries for devnet reliability
      const signature = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        maxRetries: 5,
      });
      
      // Confirm with block-height-exceeded fallback (devnet can be slow)
      toast.update(txToastId, { message: 'Confirming...', type: 'loading' });
      let confirmed = false;
      try {
        await connection.confirmTransaction({
          blockhash,
          lastValidBlockHeight,
          signature,
        }, 'confirmed');
        confirmed = true;
      } catch (confirmErr: any) {
        // Block height exceeded — TX was sent, poll to see if it landed
        if (confirmErr?.message?.includes('block height') || confirmErr?.message?.includes('expired')) {
          toast.update(txToastId, { message: 'Verifying transaction...', type: 'loading' });
          // Poll up to 10 times over ~15 seconds
          for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 1500));
            try {
              const status = await connection.getSignatureStatus(signature);
              const cs = status?.value?.confirmationStatus;
              if (cs === 'confirmed' || cs === 'finalized') {
                confirmed = true;
                console.log(`TX confirmed on poll attempt ${i + 1}:`, signature);
                break;
              }
            } catch { /* retry */ }
          }
          if (!confirmed) {
            throw new Error(
              `Transaction sent but confirmation timed out. ` +
              `Check explorer: https://explorer.solana.com/tx/${signature}?cluster=devnet`
            );
          }
        } else {
          throw confirmErr;
        }
      }
      toast.dismiss(txToastId);
      
      // Generate share link
      const shareLink = createShareLink(
        fullIdentifier,
        depositResult.leafIndex,
        POOL_ADDRESS.toBase58(),
      );
      
      setSuccess({
        signature,
        leafIndex: depositResult.leafIndex,
        shareLink,
        password,
        identifier: fullIdentifier,
        amount: amountNum,
        token: selectedToken.symbol,
      });
      
      // Register deposit with relayer for OAuth lookup (non-critical, fire-and-forget)
      // Include password for email deposits — enables voucher code creation (OTP-free claiming)
      registerDeposit.mutate({
        identifier: fullIdentifier,
        amount: amountNum,
        token: selectedToken.symbol,
        leafIndex: depositResult.leafIndex,
        pool: POOL_ADDRESS.toBase58(),
        commitment: depositResult.commitment,
        txSignature: signature,
        ...(fullIdentifier.startsWith('email:') && { password }),
      });
      
      // Persist to recent sends (localStorage)
      addRecentSend({
        amount: amountNum,
        token: selectedToken.symbol,
        recipient: fullIdentifier,
        signature,
        shareLink,
      });
      
      setStepDirection(1);
      setStep('success');
      toast.success('Sent! 🎉');
      
    } catch (error) {
      console.error('Deposit error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to send');
    } finally {
      setLoading(false);
    }
  }, [
    connected,
    publicKey,
    signTransaction,
    connection,
    selectedProvider,
    selectedToken,
    identifier,
    password,
    amount,
    registerDeposit,
    addRecentSend,
  ]);

  // Reset form
  const handleNewSend = useCallback(() => {
    setSuccess(null);
    setIdentifier('');
    setAmount('');
    setPassword(generatePassword(16));
    setStepDirection(-1);
    setStep('amount');
  }, []);

  // Wallet modal for connect action
  const { setVisible: openWalletModal } = useWalletModal();

  // Not connected state
  if (!connected) {
    return (
      <div className="send-tab">
        <EmptyState
          illustration="wallet"
          title="Connect to send"
          description="Send money privately. Only the person you pick can claim it (with the secret code)."
          action={{
            label: 'Connect wallet',
            onClick: () => openWalletModal(true),
          }}
        />
        
        <motion.div 
          className="features-footer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          <div className="feature-chips">
            <span className="feature-chip">🔒 Private</span>
            <span className="feature-chip">⚡ Instant</span>
            <span className="feature-chip">🛡️ Safer</span>
          </div>
        </motion.div>
      </div>
    );
  }

  // Success state
  if (step === 'success' && success) {
    return (
      <div className="send-tab">
        <Confetti active={true} count={60} duration={4000} />
        
        <motion.div 
          className="success-view"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
        >
          <div className="success-header">
            <motion.div 
              className="success-check"
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ 
                type: 'spring', 
                stiffness: 300,
                damping: 15,
                delay: 0.1 
              }}
            >
              <motion.span
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3, duration: 0.2 }}
              >
                ✓
              </motion.span>
            </motion.div>
            <motion.h2
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              Sent!
            </motion.h2>
            <motion.p 
              className="success-amount"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3, type: 'spring', stiffness: 200 }}
            >
              {success.amount} {success.token}
            </motion.p>
            <motion.p
              className="success-to"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
            >
              to {formatRecipient(success.identifier)}
            </motion.p>
          </div>

          {/* Primary action: Share */}
          <motion.div
            className="success-actions"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
          >
            <Button 
              variant="primary"
              size="lg"
              fullWidth
              icon={<span>📤</span>}
              onClick={() => setShowShareSheet(true)}
            >
              Share claim
            </Button>
            
            <p className="success-hint">
              Send the link and password to {formatRecipient(success.identifier)}
            </p>
          </motion.div>

          {/* Quick copy row */}
          <motion.div 
            className="quick-copy-row"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
          >
            <button 
              className={`quick-copy-btn ${copiedField === 'password' ? 'copied' : ''}`}
              onClick={() => copyToClipboard(success.password, 'password')}
            >
              <span className="quick-copy-icon">{copiedField === 'password' ? '✓' : '🔑'}</span>
              <span>{copiedField === 'password' ? 'Copied!' : 'Copy password'}</span>
            </button>
            <button 
              className={`quick-copy-btn ${copiedField === 'link' ? 'copied' : ''}`}
              onClick={() => copyToClipboard(success.shareLink, 'link')}
            >
              <span className="quick-copy-icon">{copiedField === 'link' ? '✓' : '🔗'}</span>
              <span>{copiedField === 'link' ? 'Copied!' : 'Copy link'}</span>
            </button>
          </motion.div>

          <motion.a 
            href={getExplorerUrl(success.signature)} 
            target="_blank" 
            rel="noopener noreferrer"
            className="tx-link"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7 }}
          >
            View transaction ↗
          </motion.a>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8 }}
          >
            <Button 
              variant="secondary"
              size="lg"
              fullWidth
              onClick={handleNewSend}
            >
              Send another
            </Button>
          </motion.div>
        </motion.div>

        {/* Share bottom sheet */}
        <ShareSheet
          isOpen={showShareSheet}
          onClose={() => setShowShareSheet(false)}
          data={{
            link: success.shareLink,
            password: success.password,
            amount: String(success.amount),
            token: success.token,
            recipient: success.identifier,
          }}
        />
      </div>
    );
  }

  // Main send flow
  return (
    <div className="send-tab">
      {/* Step progress indicator — hidden on success */}
      <StepProgress steps={[...SEND_STEPS]} activeStep={step} />

      <AnimatePresence mode="wait" custom={stepDirection} initial={false}>
        {/* Step 1: Amount */}
        {step === 'amount' && (
          <motion.div 
            key="amount"
            className="step-view"
            custom={stepDirection}
            variants={reducedMotion ? undefined : stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
          >
            <div className="step-body">
              {/* Balance context - Venmo-style */}
              <BalanceDisplay
                variant="inline"
                onClick={(balance) => setAmount(String(Math.floor(balance * 10000) / 10000))}
                className="send-balance"
              />

              <AmountInput
                ref={amountInputRef}
                value={amount}
                onChange={handleAmountChange}
                onSubmit={goNext}
                currency={selectedToken.symbol}
                currencySymbol={selectedToken.icon}
                maxDecimals={selectedToken.decimals}
                autoFocus
              />

              {/* Quick amount presets - Venmo style */}
              <AmountPresets
                onSelect={handleAmountChange}
                currentValue={amount}
                currency={selectedToken.symbol}
                presets={TOKEN_PRESETS[selectedToken.symbol] || TOKEN_PRESETS.SOL}
              />

              <TokenSelector
                tokens={SUPPORTED_TOKENS}
                selected={selectedToken}
                onChange={handleTokenChange}
                onMaxClick={handleMaxClick}
                balance={tokenBalance}
              />

              <HowItWorks isOpen={showHowItWorks} onClose={() => setShowHowItWorks(false)} />

              {/* Keep the amount step focused: recent activity lives in a bottom sheet */}
              <RecentSendsSheet
                isOpen={showRecentSheet}
                onClose={() => setShowRecentSheet(false)}
                sends={recentSends}
                onClear={clearRecentSends}
              />
            </div>

            <div className="step-footer">
              <Button 
                variant="primary"
                size="lg"
                fullWidth
                onClick={goNext}
                disabled={!amount || parseFloat(amount) <= 0}
              >
                Continue
              </Button>

              <div className="send-links-row">
                <button className="help-link" onClick={() => setShowHowItWorks(true)}>
                  How it works →
                </button>

                {recentSends.length > 0 && (
                  <button
                    className="help-link"
                    onClick={() => setShowRecentSheet(true)}
                    aria-label="View recent sends"
                  >
                    Recent ({recentSends.length}) →
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}

        {/* Step 2: Recipient */}
        {step === 'recipient' && (
          <motion.div 
            key="recipient"
            className="step-view"
            custom={stepDirection}
            variants={reducedMotion ? undefined : stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
          >
            <button className="back-btn" onClick={goBack}>
              ← Back
            </button>

            <div className="step-header">
              <p className="step-amount">Sending {amount} {selectedToken.symbol}</p>
              <h2>Who are you sending to?</h2>
            </div>

            {/* Provider pills */}
            <div className="provider-pills" role="radiogroup" aria-label="Choose where they’ll claim">
              {SOCIAL_PROVIDERS.map((p) => (
                <motion.button
                  key={p.id}
                  type="button"
                  className={`provider-pill ${selectedProvider === p.id ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedProvider(p.id);
                    setIdentifier('');
                    identifierInputRef.current?.focus();
                  }}
                  role="radio"
                  aria-checked={selectedProvider === p.id}
                  whileTap={{ scale: 0.97 }}
                >
                  <span className="provider-pill-icon" aria-hidden="true">{p.label}</span>
                  <span className="provider-pill-name">{p.name}</span>
                </motion.button>
              ))}
            </div>

            <div className="input-container">
              <div className="namespaced-input">
                <span className="namespace-prefix" aria-hidden="true">
                  {getProvider(selectedProvider).displayPrefix}
                </span>
                <input
                  ref={identifierInputRef}
                  type={selectedProvider === 'email' ? 'email' : 'text'}
                  className="text-input namespaced"
                  placeholder={getProvider(selectedProvider).placeholder}
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  onKeyDown={handleKeyDown}
                  maxLength={256}
                  autoComplete={selectedProvider === 'email' ? 'email' : 'off'}
                  spellCheck={false}
                  aria-label={`${getProvider(selectedProvider).name} account`}
                />
              </div>
              <p className="input-hint">
                They’ll need to sign in with this {getProvider(selectedProvider).name} account to claim.
                {getProvider(selectedProvider).example ? (
                  <> Example: <span className="input-example">{getProvider(selectedProvider).example}</span></>
                ) : null}
              </p>
            </div>

            <Button 
              variant="primary"
              size="lg"
              fullWidth
              onClick={goNext}
              disabled={!identifier}
            >
              Continue
            </Button>
          </motion.div>
        )}

        {/* Step 3: Password */}
        {step === 'password' && (
          <motion.div 
            key="password"
            className="step-view"
            custom={stepDirection}
            variants={reducedMotion ? undefined : stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
          >
            <button className="back-btn" onClick={goBack}>
              ← Back
            </button>

            <div className="step-header">
              <p className="step-amount">
                Sending {amount} {selectedToken.symbol}
                {identifier ? <> to {formatDraftRecipient(selectedProvider, identifier)}</> : null}
              </p>
              <h2>Set a secret code</h2>
            </div>

            <div className="input-container">
              <div className="password-input-row">
                <input
                  ref={passwordInputRef}
                  type="text"
                  className="text-input"
                  placeholder="Secret code…"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={handleKeyDown}
                  maxLength={128}
                  autoComplete="off"
                />
                <motion.button 
                  className={`regenerate-btn ${isRegenerating ? 'spinning' : ''}`}
                  onClick={handleRegenerate}
                  title="Generate new password"
                  whileTap={{ scale: 0.9 }}
                  aria-label="Generate random password"
                >
                  <motion.span
                    animate={isRegenerating ? { rotate: 360 } : { rotate: 0 }}
                    transition={{ duration: 0.4, ease: 'easeOut' }}
                    style={{ display: 'inline-block' }}
                  >
                    🎲
                  </motion.span>
                </motion.button>
              </div>
              
              {/* Password strength indicator */}
              {password.length > 0 && (
                <motion.div 
                  className="password-strength"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="strength-bar-track">
                    {[0, 1, 2, 3].map(i => (
                      <motion.div
                        key={i}
                        className="strength-bar-segment"
                        initial={{ scaleX: 0 }}
                        animate={{ 
                          scaleX: i < passwordStrength.score ? 1 : 0,
                          backgroundColor: i < passwordStrength.score ? passwordStrength.color : 'var(--bg-tertiary)',
                        }}
                        transition={{ duration: 0.2, delay: i * 0.05 }}
                        style={{ transformOrigin: 'left' }}
                      />
                    ))}
                  </div>
                  <span className="strength-label" style={{ color: passwordStrength.color }}>
                    {passwordStrength.label}
                  </span>
                </motion.div>
              )}
              
              <p className="input-hint">Send this code separately from the link.</p>
            </div>

            <Button 
              variant="primary"
              size="lg"
              fullWidth
              onClick={goNext}
              disabled={password.length < 8}
            >
              Review
            </Button>
          </motion.div>
        )}

        {/* Step 4: Confirm */}
        {step === 'confirm' && (
          <motion.div 
            key="confirm"
            className="step-view"
            custom={stepDirection}
            variants={reducedMotion ? undefined : stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
          >
            <button className="back-btn" onClick={goBack}>
              ← Back
            </button>

            <ConfirmationSummary
              amount={amount}
              token={selectedToken.symbol}
              tokenIcon={selectedToken.icon}
              recipient={`${getProvider(selectedProvider).prefix}${sanitizeInput(identifier)}`}
              fees={[
                { 
                  label: 'Network fee', 
                  value: '~0.00001 SOL',
                  rawValue: 0.00001,
                  tooltip: 'Paid to Solana validators for processing your transaction'
                },
              ]}
            >
              <Button 
                variant="primary"
                size="lg"
                fullWidth
                onClick={handleDeposit}
                disabled={!wasmReady}
                loading={loading}
                loadingText="Sending..."
              >
                Send privately
              </Button>

              {!wasmReady && (
                <p className="wasm-loading">Getting things ready…</p>
              )}
            </ConfirmationSummary>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
