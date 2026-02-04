import { useState, useCallback, useRef, useEffect, type FC } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { motion, AnimatePresence } from 'framer-motion';
import toast from './Toast';
import { OAuthLogin } from './OAuthLogin';
import { ProofProgress } from './ProofProgress';
import { SkeletonCard } from './Skeleton';
import { EmptyState } from './EmptyState';
import { Button } from './Button';
import { Confetti } from './Confetti';
import { RELAYER_URL, POOL_ADDRESS, getExplorerUrl } from '../lib/constants';
import './ClaimTabNew.css';

// WSOL mint address
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// WASM imports
import { generate_proof } from '../wasm/murkl_wasm';

interface Props {
  wasmReady: boolean;
}

interface Deposit {
  id: string;
  amount: number;
  token: string;
  leafIndex: number;
  timestamp: string;
  claimed: boolean;
}

/** Data extracted from a claim link URL */
interface ClaimLinkData {
  identifier: string;
  leafIndex: number;
  pool: string;
  /** Amount if we could fetch it from the relayer */
  amount?: number;
  /** Token symbol if known */
  token?: string;
}

interface PasswordSheetProps {
  deposit: Deposit;
  password: string;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  wasmReady: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

/**
 * Improved password entry bottom sheet with:
 * - Show/hide toggle for password visibility
 * - Character count indicator
 * - Visual feedback while typing
 */
const PasswordSheet: FC<PasswordSheetProps> = ({
  deposit,
  password,
  onPasswordChange,
  onSubmit,
  onClose,
  wasmReady,
  inputRef,
}) => {
  const [showPassword, setShowPassword] = useState(false);
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && password) {
      e.preventDefault();
      onSubmit();
    }
  };

  // Password readiness indicator
  const isReady = password.length >= 8;
  
  return (
    <>
      <motion.div 
        className="sheet-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div 
        className="password-sheet"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      >
        <div className="sheet-handle" onClick={onClose} />
        
        <div className="sheet-content">
          <div className="sheet-header">
            <motion.span 
              className="sheet-icon"
              animate={{ 
                scale: password.length > 0 ? [1, 1.1, 1] : 1,
              }}
              transition={{ duration: 0.2 }}
              key={password.length > 0 ? 'active' : 'idle'}
            >
              {isReady ? '🔓' : '🔑'}
            </motion.span>
            <h3>Enter Password</h3>
            <p>Claim {deposit.amount} {deposit.token}</p>
          </div>
          
          <div className="password-input-wrapper">
            <input
              ref={inputRef}
              type={showPassword ? 'text' : 'password'}
              className={`password-input ${password.length > 0 ? 'has-value' : ''} ${isReady ? 'ready' : ''}`}
              placeholder="Password..."
              value={password}
              onChange={e => onPasswordChange(e.target.value)}
              onKeyDown={handleKeyDown}
              autoComplete="off"
              spellCheck={false}
            />
            <motion.button
              type="button"
              className="password-toggle"
              onClick={() => setShowPassword(!showPassword)}
              whileTap={{ scale: 0.9 }}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? '🙈' : '👁️'}
            </motion.button>
          </div>
          
          {/* Character count / ready indicator */}
          <motion.div 
            className={`password-hint ${isReady ? 'ready' : ''}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
          >
            {password.length === 0 ? (
              <span>Enter the password shared by sender</span>
            ) : isReady ? (
              <motion.span
                initial={{ scale: 0.9 }}
                animate={{ scale: 1 }}
                className="ready-text"
              >
                ✓ Ready to claim
              </motion.span>
            ) : (
              <span>{password.length}/8 characters minimum</span>
            )}
          </motion.div>
          
          <div className="sheet-actions">
            <Button 
              variant="ghost"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button 
              variant="primary"
              onClick={onSubmit}
              disabled={!password || password.length < 8}
              loading={!wasmReady}
              loadingText="Loading..."
            >
              Claim
            </Button>
          </div>
        </div>
      </motion.div>
    </>
  );
};

type ClaimStage = 'idle' | 'generating' | 'uploading' | 'verifying' | 'claiming' | 'complete';

/**
 * Manual claim section with expandable input.
 * For users who have a claim link or want to enter identity manually.
 */
const ManualClaimSection: FC<{ onLogin: (provider: string, handle: string) => void }> = ({ onLogin }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleSubmit = useCallback(() => {
    if (!input.trim()) return;
    
    // Parse claim link or use as identifier
    let identifier = input.trim();
    
    // Try to extract from URL if it looks like a link
    if (identifier.includes('://') || identifier.includes('?')) {
      try {
        const url = new URL(identifier.startsWith('http') ? identifier : `https://${identifier}`);
        const id = url.searchParams.get('id') || url.searchParams.get('identity');
        if (id) identifier = id;
      } catch {
        // Not a valid URL, use as-is
      }
    }
    
    onLogin('manual', identifier);
    setInput('');
    setIsOpen(false);
  }, [input, onLogin]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && input.trim()) {
      handleSubmit();
    }
    if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <motion.div 
      className="manual-claim-section"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.5 }}
    >
      <AnimatePresence mode="wait">
        {!isOpen ? (
          <motion.button
            key="trigger"
            className="manual-claim-trigger"
            onClick={() => setIsOpen(true)}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
          >
            <span className="trigger-icon">🔗</span>
            <span className="trigger-text">Have a claim link?</span>
            <span className="trigger-arrow">→</span>
          </motion.button>
        ) : (
          <motion.div
            key="form"
            className="manual-claim-form"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <div className="manual-claim-header">
              <button 
                className="manual-claim-back"
                onClick={() => setIsOpen(false)}
              >
                ← Back
              </button>
              <h4>Enter claim link or identity</h4>
            </div>
            
            <input
              ref={inputRef}
              type="text"
              className="manual-claim-input"
              placeholder="Paste link or @handle..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              autoComplete="off"
            />
            
            <Button
              variant="primary"
              fullWidth
              onClick={handleSubmit}
              disabled={!input.trim()}
            >
              Continue
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

/**
 * Claim Link Landing — Venmo-style "You received" hero screen.
 * Shown when user arrives via a claim link (?id=...&leaf=...).
 * Skips OAuth and goes directly to password entry → proof → claim.
 */
const ClaimLanding: FC<{
  data: ClaimLinkData;
  wasmReady: boolean;
  connected: boolean;
  onPasswordSubmit: (password: string) => void;
  onSwitchToOAuth: () => void;
}> = ({ data, wasmReady, connected, onPasswordSubmit, onSwitchToOAuth }) => {
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

export const ClaimTabNew: FC<Props> = ({ wasmReady }) => {
  const { connected, publicKey } = useWallet();
  
  // Claim link state (from URL params)
  const [claimLinkData, setClaimLinkData] = useState<ClaimLinkData | null>(null);
  const [showOAuthOverride, setShowOAuthOverride] = useState(false);
  
  // Auth state
  const [identity, setIdentity] = useState<{ provider: string; handle: string } | null>(null);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [loadingDeposits, setLoadingDeposits] = useState(false);
  
  // Claim state
  const [claimingDeposit, setClaimingDeposit] = useState<Deposit | null>(null);
  const [stage, setStage] = useState<ClaimStage>('idle');
  const [proofProgress, setProofProgress] = useState(0);
  const [password, setPassword] = useState('');
  const [showPasswordSheet, setShowPasswordSheet] = useState<Deposit | null>(null);
  const [successSignature, setSuccessSignature] = useState<string | null>(null);
  
  // Refs
  const passwordInputRef = useRef<HTMLInputElement>(null);

  // Parse URL params for claim link data
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    const leaf = params.get('leaf');
    const pool = params.get('pool');
    
    if (id && leaf) {
      const linkData: ClaimLinkData = {
        identifier: id,
        leafIndex: parseInt(leaf, 10),
        pool: pool || POOL_ADDRESS.toBase58(),
      };
      
      setClaimLinkData(linkData);
      
      // Try to fetch deposit info from relayer for the amount
      if (RELAYER_URL) {
        fetch(`${RELAYER_URL}/deposits?identity=${encodeURIComponent(id)}`)
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (data?.deposits) {
              const match = data.deposits.find(
                (d: Deposit) => d.leafIndex === linkData.leafIndex && !d.claimed
              );
              if (match) {
                setClaimLinkData(prev => prev ? {
                  ...prev,
                  amount: match.amount,
                  token: match.token || 'SOL',
                } : prev);
              }
            }
          })
          .catch(() => {
            // Non-critical — landing works fine without amount
          });
      }
    }
  }, []);

  // Focus password input when sheet opens
  useEffect(() => {
    if (showPasswordSheet) {
      setTimeout(() => passwordInputRef.current?.focus(), 100);
    }
  }, [showPasswordSheet]);

  // Handle OAuth login
  const handleLogin = useCallback(async (provider: string, handle: string) => {
    setIdentity({ provider, handle });
    setLoadingDeposits(true);
    
    try {
      const response = await fetch(`${RELAYER_URL}/deposits?identity=${encodeURIComponent(handle)}`);
      
      if (response.ok) {
        const data = await response.json();
        setDeposits(data.deposits || []);
        
        if (data.deposits?.length === 0) {
          toast.info('No deposits yet — ask someone to send!', { icon: '📭' });
        } else {
          toast.success(`Found ${data.deposits.length} deposit(s)!`);
        }
      } else {
        // Demo mode
        setDeposits([
          {
            id: 'demo-1',
            amount: 0.1,
            token: 'SOL',
            leafIndex: 1,
            timestamp: new Date().toISOString(),
            claimed: false,
          },
        ]);
        toast.success('Demo: Found 1 deposit');
      }
    } catch {
      // Demo fallback
      setDeposits([
        {
          id: 'demo-1',
          amount: 0.1,
          token: 'SOL',
          leafIndex: 1,
          timestamp: new Date().toISOString(),
          claimed: false,
        },
      ]);
    } finally {
      setLoadingDeposits(false);
    }
  }, []);

  // Initiate claim (opens password sheet)
  const initiateClaim = useCallback((deposit: Deposit) => {
    if (!connected || !publicKey) {
      toast.error('Connect your wallet first');
      return;
    }
    setShowPasswordSheet(deposit);
    setPassword('');
  }, [connected, publicKey]);

  // Execute claim with password
  const executeClaim = useCallback(async () => {
    if (!showPasswordSheet || !password || !identity || !publicKey || !wasmReady) return;
    
    const deposit = showPasswordSheet;
    setShowPasswordSheet(null);
    setClaimingDeposit(deposit);
    setStage('generating');
    setProofProgress(0);

    try {
      // Simulate proof progress (in real impl, WASM would report progress)
      const progressInterval = setInterval(() => {
        setProofProgress(prev => {
          if (prev >= 95) {
            clearInterval(progressInterval);
            return prev;
          }
          return prev + Math.random() * 8 + 2;
        });
      }, 200);

      // Fetch merkle root from pool (needed for proof generation)
      const poolInfoRes = await fetch(`${RELAYER_URL}/pool-info?pool=${POOL_ADDRESS.toBase58()}`);
      let merkleRoot = '0'.repeat(64); // Default if fetch fails
      if (poolInfoRes.ok) {
        const poolInfo = await poolInfoRes.json();
        merkleRoot = poolInfo.merkleRoot || merkleRoot;
      }
      
      // Generate proof
      console.log('[DEBUG CLAIM] Generating proof with:', {
        identifier: identity.handle,
        passwordLength: password.length,
        leafIndex: deposit.leafIndex,
        merkleRoot: merkleRoot.slice(0, 16) + '...'
      });
      const proofResult = await generate_proof(
        identity.handle,
        password,
        deposit.leafIndex,
        merkleRoot
      );
      console.log('[DEBUG CLAIM] Proof result:', {
        commitment: proofResult.commitment,
        nullifier: proofResult.nullifier?.slice(0, 16) + '...',
        proofSize: proofResult.proof?.length
      });
      
      clearInterval(progressInterval);
      setProofProgress(100);

      if (proofResult.error) {
        throw new Error(proofResult.error);
      }

      // Upload proof
      setStage('uploading');
      await new Promise(r => setTimeout(r, 500)); // Brief pause for UX

      // Submit to relayer
      setStage('verifying');
      // Derive recipient's WSOL Associated Token Account
      const recipientATA = await getAssociatedTokenAddress(
        WSOL_MINT,
        publicKey
      );

      const response = await fetch(`${RELAYER_URL}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proof: proofResult.proof,
          commitment: proofResult.commitment,
          nullifier: proofResult.nullifier,
          recipientTokenAccount: recipientATA.toBase58(),
          poolAddress: POOL_ADDRESS.toBase58(),
          leafIndex: deposit.leafIndex,
          feeBps: 50,
        }),
      });

      if (!response.ok) {
        throw new Error('Claim failed — try again');
      }

      const result = await response.json();
      
      // Claiming
      setStage('claiming');
      await new Promise(r => setTimeout(r, 500));
      
      // Success!
      setStage('complete');
      setSuccessSignature(result.signature || null);
      
      // Update deposit list
      setDeposits(prev => 
        prev.map(d => d.id === deposit.id ? { ...d, claimed: true } : d)
      );

      toast.success('Claimed! 🎉');
      
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Claim failed';
      toast.error(message);
      setStage('idle');
      setClaimingDeposit(null);
    }
  }, [showPasswordSheet, password, identity, publicKey, wasmReady]);

  // Reset after success
  const handleClaimComplete = useCallback(() => {
    setStage('idle');
    setClaimingDeposit(null);
    setProofProgress(0);
    setSuccessSignature(null);
  }, []);

  // Handle logout
  const handleLogout = () => {
    setIdentity(null);
    setDeposits([]);
  };

  // Handle claim from landing page (claim link flow)
  const handleLandingClaim = useCallback(async (landingPassword: string) => {
    if (!claimLinkData || !publicKey || !wasmReady) return;
    
    // Create a synthetic deposit from the link data
    const syntheticDeposit: Deposit = {
      id: `link-${claimLinkData.leafIndex}`,
      amount: claimLinkData.amount || 0,
      token: claimLinkData.token || 'SOL',
      leafIndex: claimLinkData.leafIndex,
      timestamp: new Date().toISOString(),
      claimed: false,
    };
    
    // Set identity from the link
    setIdentity({ provider: 'link', handle: claimLinkData.identifier });
    
    // Execute claim directly
    setClaimingDeposit(syntheticDeposit);
    setStage('generating');
    setProofProgress(0);

    try {
      const progressInterval = setInterval(() => {
        setProofProgress(prev => {
          if (prev >= 95) {
            clearInterval(progressInterval);
            return prev;
          }
          return prev + Math.random() * 8 + 2;
        });
      }, 200);

      // Fetch merkle root
      let merkleRoot = '0'.repeat(64);
      if (RELAYER_URL) {
        try {
          const poolAddr = claimLinkData.pool || POOL_ADDRESS.toBase58();
          const poolInfoRes = await fetch(`${RELAYER_URL}/pool-info?pool=${poolAddr}`);
          if (poolInfoRes.ok) {
            const poolInfo = await poolInfoRes.json();
            merkleRoot = poolInfo.merkleRoot || merkleRoot;
          }
        } catch {
          // Use default
        }
      }
      
      // Generate proof
      const proofResult = await generate_proof(
        claimLinkData.identifier,
        landingPassword,
        claimLinkData.leafIndex,
        merkleRoot
      );
      
      clearInterval(progressInterval);
      setProofProgress(100);

      if (proofResult.error) {
        throw new Error(proofResult.error);
      }

      // Upload proof
      setStage('uploading');
      await new Promise(r => setTimeout(r, 500));

      // Submit to relayer
      setStage('verifying');
      const recipientATA = await getAssociatedTokenAddress(WSOL_MINT, publicKey);

      const response = await fetch(`${RELAYER_URL}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proof: proofResult.proof,
          commitment: proofResult.commitment,
          nullifier: proofResult.nullifier,
          recipientTokenAccount: recipientATA.toBase58(),
          poolAddress: claimLinkData.pool || POOL_ADDRESS.toBase58(),
          leafIndex: claimLinkData.leafIndex,
          feeBps: 50,
        }),
      });

      if (!response.ok) {
        throw new Error('Claim failed — try again');
      }

      const result = await response.json();
      
      setStage('claiming');
      await new Promise(r => setTimeout(r, 500));
      
      setStage('complete');
      setSuccessSignature(result.signature || null);
      
      // Clean URL params after successful claim
      const url = new URL(window.location.href);
      url.searchParams.delete('id');
      url.searchParams.delete('leaf');
      url.searchParams.delete('pool');
      window.history.replaceState({}, '', url.toString());
      
      toast.success('Claimed! 🎉');
      
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Claim failed';
      toast.error(message);
      setStage('idle');
      setClaimingDeposit(null);
    }
  }, [claimLinkData, publicKey, wasmReady]);

  // Claim link landing → show hero experience (skips OAuth)
  if (claimLinkData && !identity && !showOAuthOverride) {
    return (
      <div className="claim-tab-new">
        <ClaimLanding
          data={claimLinkData}
          wasmReady={wasmReady}
          connected={connected}
          onPasswordSubmit={handleLandingClaim}
          onSwitchToOAuth={() => setShowOAuthOverride(true)}
        />
      </div>
    );
  }

  // Not logged in → OAuth
  if (!identity) {
    return (
      <div className="claim-tab-new">
        <OAuthLogin onLogin={handleLogin} loading={loadingDeposits} />
        
        <ManualClaimSection onLogin={handleLogin} />
      </div>
    );
  }

  // Claiming in progress → show ProofProgress
  if (claimingDeposit && stage !== 'idle') {
    return (
      <div className="claim-tab-new">
        <AnimatePresence mode="wait">
          {stage === 'complete' ? (
            <motion.div
              key="success"
              className="claim-success"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
            >
              {/* Celebration confetti! */}
              <Confetti active={true} count={50} duration={3500} />
              
              {/* Animated success header */}
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
                  Claimed!
                </motion.h2>
                
                <motion.p 
                  className="claim-amount"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.3, type: 'spring', stiffness: 200 }}
                >
                  {claimingDeposit.amount} {claimingDeposit.token}
                </motion.p>
                
                <motion.p 
                  className="claim-to"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.4 }}
                >
                  is now in your wallet
                </motion.p>
              </div>

              {/* Celebration message */}
              <motion.div 
                className="success-celebration"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
              >
                <span className="celebration-emoji">🎉</span>
                <p>Private transfer complete — no trace left behind</p>
              </motion.div>
              
              {successSignature && (
                <motion.a 
                  href={getExplorerUrl(successSignature)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tx-link"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.6 }}
                >
                  View transaction ↗
                </motion.a>
              )}
              
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.7 }}
              >
                <Button variant="primary" size="lg" fullWidth onClick={handleClaimComplete}>
                  Done
                </Button>
              </motion.div>
            </motion.div>
          ) : (
            <motion.div
              key="progress"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <div className="claiming-header">
                <p>Claiming {claimingDeposit.amount} {claimingDeposit.token}</p>
              </div>
              <ProofProgress 
                stage={stage} 
                progress={proofProgress}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // Logged in → deposits list
  return (
    <div className="claim-tab-new">
      {/* Identity header */}
      <div className="identity-header">
        <div className="identity-info">
          <span className="identity-icon">
            {identity.provider === 'twitter' ? '𝕏' : 
             identity.provider === 'discord' ? '🎮' : '🔵'}
          </span>
          <span className="identity-handle">{identity.handle}</span>
        </div>
        <button className="btn btn-ghost" onClick={handleLogout}>
          Switch
        </button>
      </div>

      {/* Deposits section */}
      <div className="deposits-section">
        {loadingDeposits ? (
          <div className="loading-state">
            <p className="loading-label">Checking for deposits...</p>
            <div className="skeleton-list">
              <SkeletonCard />
              <SkeletonCard />
            </div>
          </div>
        ) : deposits.length === 0 ? (
          <EmptyState
            illustration="inbox"
            title="No deposits yet"
            description="Ask someone to send you tokens via Murkl — or switch tabs to send yourself!"
            compact
          />
        ) : (
          <div className="deposits-list">
            {deposits.map(deposit => (
              <motion.div 
                key={deposit.id} 
                className={`deposit-card ${deposit.claimed ? 'claimed' : ''}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <div className="deposit-content">
                  <div className="deposit-icon">💰</div>
                  <div className="deposit-details">
                    <span className="deposit-amount">
                      {deposit.amount} {deposit.token}
                    </span>
                    <span className="deposit-date">
                      {new Date(deposit.timestamp).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                
                {deposit.claimed ? (
                  <span className="claimed-badge">✓ Claimed</span>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => initiateClaim(deposit)}
                    disabled={!connected}
                  >
                    Claim
                  </Button>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Wallet reminder */}
      {!connected && deposits.some(d => !d.claimed) && (
        <div className="wallet-reminder">
          <p>👛 Connect your wallet to claim</p>
        </div>
      )}

      {/* Password bottom sheet */}
      <AnimatePresence>
        {showPasswordSheet && (
          <PasswordSheet
            deposit={showPasswordSheet}
            password={password}
            onPasswordChange={setPassword}
            onSubmit={executeClaim}
            onClose={() => setShowPasswordSheet(null)}
            wasmReady={wasmReady}
            inputRef={passwordInputRef}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default ClaimTabNew;
