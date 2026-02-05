import { useState, useCallback, useRef, useEffect } from 'react';
import type { FC } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { motion, AnimatePresence } from 'framer-motion';
import toast from './Toast';
import { buildDepositTransaction, generatePassword, createShareLink } from '../lib/deposit';
import { isValidIdentifier, isValidPassword, isValidAmount, sanitizeInput } from '../lib/validation';
import { POOL_ADDRESS, RELAYER_URL, getExplorerUrl } from '../lib/constants';
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

export const SendTab: FC<Props> = ({ wasmReady }) => {
  const { connected, publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  
  // Form state
  const [amount, setAmount] = useState('');
  const [selectedToken, setSelectedToken] = useState<Token>(SUPPORTED_TOKENS[0]);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<Step>('amount');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<DepositSuccess | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [showShareSheet, setShowShareSheet] = useState(false);
  const [tokenBalance, setTokenBalance] = useState<number | null>(null);
  
  // Refs
  const amountInputRef = useRef<AmountInputHandle>(null);
  const identifierInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);

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

  // Fetch token balance when wallet connects or token changes
  useEffect(() => {
    if (!connected || !publicKey) {
      setTokenBalance(null);
      return;
    }

    const fetchBalance = async () => {
      try {
        if (selectedToken.symbol === 'SOL') {
          // Native SOL balance
          const balance = await connection.getBalance(publicKey);
          setTokenBalance(balance / 1e9); // Convert lamports to SOL
        } else if (selectedToken.symbol === 'WSOL') {
          // WSOL (wrapped SOL) token account balance
          const { getAssociatedTokenAddress } = await import('@solana/spl-token');
          const { PublicKey } = await import('@solana/web3.js');
          const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
          const ata = await getAssociatedTokenAddress(WSOL_MINT, publicKey);
          const ataInfo = await connection.getAccountInfo(ata);
          if (ataInfo) {
            // Parse token account data - balance is at offset 64, u64 LE
            const balance = ataInfo.data.readBigUInt64LE(64);
            setTokenBalance(Number(balance) / 1e9);
          } else {
            setTokenBalance(0);
          }
        } else {
          // For other SPL tokens
          setTokenBalance(null);
        }
      } catch (e) {
        console.warn('Failed to fetch balance:', e);
        setTokenBalance(null);
      }
    };

    fetchBalance();
  }, [connected, publicKey, selectedToken, connection]);

  // Handle token change
  const handleTokenChange = useCallback((token: Token) => {
    setSelectedToken(token);
    // Reset amount when switching tokens
    setAmount('');
  }, []);

  // Handle Max button click - fills in max balance (minus small buffer for fees)
  const handleMaxClick = useCallback((balance: number) => {
    // Leave a small buffer for transaction fees (0.001 SOL for native, none for tokens)
    const feeBuffer = selectedToken.symbol === 'SOL' ? 0.001 : 0;
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

  // Navigation
  const goNext = useCallback(() => {
    if (step === 'amount') {
      if (!isValidAmount(amount)) {
        amountInputRef.current?.shake();
        toast.error('Enter a valid amount');
        return;
      }
      setStep('recipient');
    } else if (step === 'recipient') {
      if (!isValidIdentifier(identifier)) {
        toast.error('Enter a valid recipient');
        return;
      }
      setStep('password');
    } else if (step === 'password') {
      if (!isValidPassword(password)) {
        toast.error('Password must be 8-128 characters');
        return;
      }
      setStep('confirm');
    }
  }, [step, amount, identifier, password]);

  const goBack = useCallback(() => {
    if (step === 'recipient') setStep('amount');
    else if (step === 'password') setStep('recipient');
    else if (step === 'confirm') setStep('password');
  }, [step]);

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
      const cleanIdentifier = sanitizeInput(identifier);
      const amountNum = parseFloat(amount);
      
      // Build transaction
      // If user selected SOL, wrap native SOL to WSOL
      // If user selected WSOL, use existing WSOL directly
      const wrapSol = selectedToken.symbol === 'SOL';
      const depositResult = await buildDepositTransaction(
        connection,
        POOL_ADDRESS,
        publicKey,
        cleanIdentifier,
        password,
        amountNum,
        { wrapSol },
      );
      
      // Set recent blockhash and fee payer
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      depositResult.transaction.recentBlockhash = blockhash;
      depositResult.transaction.feePayer = publicKey;
      
      // Sign transaction
      const txToastId = toast.loading('Approve in wallet...');
      const signed = await signTransaction(depositResult.transaction);
      toast.update(txToastId, { message: 'Sending...', type: 'loading' });
      
      // Send transaction
      const signature = await connection.sendRawTransaction(signed.serialize());
      
      // Confirm transaction
      toast.update(txToastId, { message: 'Confirming...', type: 'loading' });
      await connection.confirmTransaction({
        blockhash,
        lastValidBlockHeight,
        signature,
      }, 'confirmed');
      toast.dismiss(txToastId);
      
      // Generate share link
      const shareLink = createShareLink(
        cleanIdentifier,
        depositResult.leafIndex,
        POOL_ADDRESS.toBase58(),
      );
      
      setSuccess({
        signature,
        leafIndex: depositResult.leafIndex,
        shareLink,
        password,
        identifier: cleanIdentifier,
        amount: amountNum,
        token: selectedToken.symbol,
      });
      
      // Register deposit with relayer for OAuth lookup
      try {
        await fetch(`${RELAYER_URL}/deposits/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            identifier: cleanIdentifier,
            amount: amountNum,
            token: selectedToken.symbol,
            leafIndex: depositResult.leafIndex,
            pool: POOL_ADDRESS.toBase58(),
            commitment: depositResult.commitment,
            txSignature: signature,
          }),
        });
      } catch (e) {
        // Non-critical
        console.warn('Failed to register deposit with relayer:', e);
      }
      
      setStep('success');
      toast.success('Sent! 🎉');
      
    } catch (error) {
      console.error('Deposit error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to send');
    } finally {
      setLoading(false);
    }
  }, [connected, publicKey, signTransaction, connection, identifier, password, amount]);

  // Reset form
  const handleNewSend = useCallback(() => {
    setSuccess(null);
    setIdentifier('');
    setAmount('');
    setPassword(generatePassword(16));
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
          title="Connect to Send"
          description="Send tokens privately with zero-knowledge proofs — no signature needed to claim"
          action={{
            label: 'Connect Wallet',
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
            <span className="feature-chip">🛡️ Post-quantum</span>
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
              to {success.identifier}
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
              Share with {success.identifier.split('@')[0] || success.identifier}
            </Button>
            
            <p className="success-hint">
              They'll need the password to claim
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
              className="quick-copy-btn"
              onClick={() => copyToClipboard(success.password, 'password')}
            >
              <span className="quick-copy-icon">{copiedField === 'password' ? '✓' : '🔑'}</span>
              <span>{copiedField === 'password' ? 'Copied!' : 'Copy password'}</span>
            </button>
            <button 
              className="quick-copy-btn"
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
      <AnimatePresence mode="wait">
        {/* Step 1: Amount */}
        {step === 'amount' && (
          <motion.div 
            key="amount"
            className="step-view"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
          >
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

            <Button 
              variant="primary"
              size="lg"
              fullWidth
              onClick={goNext}
              disabled={!amount || parseFloat(amount) <= 0}
            >
              Continue
            </Button>

            <button className="help-link" onClick={() => setShowHowItWorks(true)}>
              How it works →
            </button>
            
            <HowItWorks isOpen={showHowItWorks} onClose={() => setShowHowItWorks(false)} />
          </motion.div>
        )}

        {/* Step 2: Recipient */}
        {step === 'recipient' && (
          <motion.div 
            key="recipient"
            className="step-view"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
          >
            <button className="back-btn" onClick={goBack}>
              ← Back
            </button>

            <div className="step-header">
              <p className="step-amount">Sending {amount} {selectedToken.symbol}</p>
              <h2>Who's it for?</h2>
            </div>

            <div className="input-container">
              <input
                ref={identifierInputRef}
                type="text"
                className="text-input"
                placeholder="@twitter, email, discord..."
                value={identifier}
                onChange={e => setIdentifier(e.target.value)}
                onKeyDown={handleKeyDown}
                maxLength={256}
                autoComplete="off"
                spellCheck={false}
              />
              <p className="input-hint">Their handle — only they can claim</p>
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
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
          >
            <button className="back-btn" onClick={goBack}>
              ← Back
            </button>

            <div className="step-header">
              <p className="step-amount">Sending {amount} {selectedToken.symbol} to {identifier}</p>
              <h2>Create a password</h2>
            </div>

            <div className="input-container">
              <div className="password-input-row">
                <input
                  ref={passwordInputRef}
                  type="text"
                  className="text-input"
                  placeholder="Enter password..."
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={handleKeyDown}
                  maxLength={128}
                  autoComplete="off"
                />
                <button 
                  className="regenerate-btn"
                  onClick={() => setPassword(generatePassword(16))}
                  title="Generate new password"
                >
                  🎲
                </button>
              </div>
              <p className="input-hint">Share this with the recipient secretly</p>
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
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
          >
            <button className="back-btn" onClick={goBack}>
              ← Back
            </button>

            <ConfirmationSummary
              amount={amount}
              token={selectedToken.symbol}
              tokenIcon={selectedToken.icon}
              recipient={identifier}
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
                <p className="wasm-loading">Loading prover...</p>
              )}
            </ConfirmationSummary>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
