import { useState, useCallback, useRef, useEffect } from 'react';
import type { FC } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { QRCodeSVG } from 'qrcode.react';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { buildDepositTransaction, generatePassword, createShareLink } from '../lib/deposit';
import { isValidIdentifier, isValidPassword, isValidAmount, sanitizeInput } from '../lib/validation';
import { POOL_ADDRESS, RELAYER_URL, getExplorerUrl } from '../lib/constants';
import { HowItWorks } from './HowItWorks';
import { AmountInput } from './AmountInput';
import './SendTab.css';

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
}

type Step = 'amount' | 'recipient' | 'password' | 'confirm' | 'success';

export const SendTab: FC<Props> = ({ wasmReady }) => {
  const { connected, publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  
  // Form state
  const [amount, setAmount] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<Step>('amount');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<DepositSuccess | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  
  // Refs
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
      const depositResult = await buildDepositTransaction(
        connection,
        POOL_ADDRESS,
        publicKey,
        cleanIdentifier,
        password,
        amountNum,
      );
      
      // Set recent blockhash and fee payer
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      depositResult.transaction.recentBlockhash = blockhash;
      depositResult.transaction.feePayer = publicKey;
      
      // Sign transaction
      toast.loading('Approve in wallet...', { id: 'tx' });
      const signed = await signTransaction(depositResult.transaction);
      toast.dismiss('tx');
      
      // Send transaction
      toast.loading('Sending...', { id: 'tx' });
      const signature = await connection.sendRawTransaction(signed.serialize());
      
      // Confirm transaction
      toast.loading('Confirming...', { id: 'tx' });
      await connection.confirmTransaction({
        blockhash,
        lastValidBlockHeight,
        signature,
      }, 'confirmed');
      toast.dismiss('tx');
      
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
      });
      
      // Register deposit with relayer for OAuth lookup
      try {
        await fetch(`${RELAYER_URL}/deposits/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            identifier: cleanIdentifier,
            amount: amountNum,
            token: 'SOL',
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

  // Not connected state
  if (!connected) {
    return (
      <div className="send-tab">
        <motion.div 
          className="connect-prompt"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="prompt-icon">🔐</div>
          <h2>Connect to Send</h2>
          <p>Connect your wallet to send tokens privately</p>
          
          <div className="features">
            <div className="feature">
              <span className="feature-icon">🔒</span>
              <span>Completely private</span>
            </div>
            <div className="feature">
              <span className="feature-icon">⚡</span>
              <span>No signature needed to claim</span>
            </div>
            <div className="feature">
              <span className="feature-icon">🛡️</span>
              <span>Post-quantum secure</span>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  // Success state
  if (step === 'success' && success) {
    return (
      <div className="send-tab">
        <motion.div 
          className="success-view"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          <div className="success-header">
            <motion.div 
              className="success-check"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', delay: 0.1 }}
            >
              ✓
            </motion.div>
            <h2>Sent!</h2>
            <p className="success-amount">{success.amount} SOL</p>
            <p className="success-to">to {success.identifier}</p>
          </div>

          <div className="share-section">
            <h3>Share with recipient</h3>
            <p className="share-hint">Send them the password securely (call, Signal, etc)</p>
            
            <div className="share-field">
              <label>Password</label>
              <div className="copy-row">
                <code>{success.password}</code>
                <button 
                  className="copy-btn"
                  onClick={() => copyToClipboard(success.password, 'password')}
                >
                  {copiedField === 'password' ? '✓' : '📋'}
                </button>
              </div>
            </div>

            <div className="share-field">
              <label>Claim link</label>
              <div className="copy-row">
                <code className="truncate">{success.shareLink}</code>
                <button 
                  className="copy-btn"
                  onClick={() => copyToClipboard(success.shareLink, 'link')}
                >
                  {copiedField === 'link' ? '✓' : '📋'}
                </button>
              </div>
            </div>

            <div className="qr-section">
              <p>Or scan to claim</p>
              <div className="qr-code">
                <QRCodeSVG 
                  value={success.shareLink} 
                  size={160}
                  bgColor="#ffffff"
                  fgColor="#0a0a0f"
                  level="M"
                />
              </div>
            </div>
          </div>

          <a 
            href={getExplorerUrl(success.signature)} 
            target="_blank" 
            rel="noopener noreferrer"
            className="tx-link"
          >
            View transaction ↗
          </a>

          <button className="action-btn secondary" onClick={handleNewSend}>
            Send another
          </button>
        </motion.div>
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
            <AmountInput
              value={amount}
              onChange={handleAmountChange}
              onSubmit={goNext}
              currency="SOL"
              currencySymbol="◎"
              maxDecimals={9}
              autoFocus
            />

            <button 
              className="action-btn primary"
              onClick={goNext}
              disabled={!amount || parseFloat(amount) <= 0}
            >
              Continue
            </button>

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
              <p className="step-amount">Sending {amount} SOL</p>
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

            <button 
              className="action-btn primary"
              onClick={goNext}
              disabled={!identifier}
            >
              Continue
            </button>
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
              <p className="step-amount">Sending {amount} SOL to {identifier}</p>
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

            <button 
              className="action-btn primary"
              onClick={goNext}
              disabled={password.length < 8}
            >
              Review
            </button>
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

            <div className="confirm-card">
              <p className="confirm-label">You're sending</p>
              <p className="confirm-amount">{amount} SOL</p>
              <p className="confirm-to">to {identifier}</p>
              
              <div className="confirm-details">
                <div className="confirm-row">
                  <span>Network fee</span>
                  <span>~0.00001 SOL</span>
                </div>
              </div>
            </div>

            <button 
              className="action-btn primary"
              onClick={handleDeposit}
              disabled={loading || !wasmReady}
            >
              {loading ? (
                <>
                  <span className="spinner" />
                  Sending...
                </>
              ) : (
                'Send privately'
              )}
            </button>

            {!wasmReady && (
              <p className="wasm-loading">Loading prover...</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
