import { useState, useCallback, useRef, useEffect, type FC } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import toast from './Toast';
import { OAuthLogin } from './OAuthLogin';
import { ProofProgress } from './ProofProgress';
import { SkeletonCard } from './Skeleton';
import { EmptyState } from './EmptyState';
import { Button } from './Button';
import { Confetti } from './Confetti';
import { PasswordSheet } from './PasswordSheet';
import { ClaimLanding, type ClaimLinkData } from './ClaimLanding';
import { useClaimFlow } from '../hooks/useClaimFlow';
import { useDeposits, depositKeys } from '../hooks/useDeposits';
import { RELAYER_URL, POOL_ADDRESS, getExplorerUrl } from '../lib/constants';
import './ClaimTabNew.css';

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

export const ClaimTabNew: FC<Props> = ({ wasmReady }) => {
  const { connected, publicKey } = useWallet();
  const queryClient = useQueryClient();

  // Shared claim pipeline
  const { stage, proofProgress, successSignature, executeClaim, reset } = useClaimFlow(wasmReady);

  // Claim link state (from URL params)
  const [claimLinkData, setClaimLinkData] = useState<ClaimLinkData | null>(null);
  const [showOAuthOverride, setShowOAuthOverride] = useState(false);

  // Auth state
  const [identity, setIdentity] = useState<{ provider: string; handle: string } | null>(null);

  // TanStack Query: deposits for authenticated identity
  const { data: deposits = [], isPending: loadingDeposits } = useDeposits(identity?.handle ?? null);

  // Claim state
  const [claimingDeposit, setClaimingDeposit] = useState<Deposit | null>(null);
  const [password, setPassword] = useState('');
  const [showPasswordSheet, setShowPasswordSheet] = useState<Deposit | null>(null);

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
      {
        fetch(`${RELAYER_URL}/deposits?identity=${encodeURIComponent(id)}`)
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (data?.deposits) {
              const match = data.deposits.find(
                (d: Deposit) => d.leafIndex === linkData.leafIndex && !d.claimed,
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

  // Handle OAuth login — just set identity; deposits load automatically via useDeposits
  const handleLogin = useCallback(async (provider: string, handle: string) => {
    setIdentity({ provider, handle });
  }, []);

  // Show toasts when deposits load
  useEffect(() => {
    if (!identity || loadingDeposits) return;
    // Only toast on initial load (not refetches)
    if (deposits.length === 0) {
      toast.info('No deposits yet — ask someone to send!', { icon: '📭' });
    } else {
      toast.success(`Found ${deposits.length} deposit(s)!`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity?.handle, loadingDeposits]);

  // Initiate claim (opens password sheet)
  const initiateClaim = useCallback((deposit: Deposit) => {
    if (!connected || !publicKey) {
      toast.error('Connect your wallet first');
      return;
    }
    setShowPasswordSheet(deposit);
    setPassword('');
  }, [connected, publicKey]);

  // Execute claim with password (OAuth flow)
  const handleExecuteClaim = useCallback(async () => {
    if (!showPasswordSheet || !password || !identity) return;

    const deposit = showPasswordSheet;
    setShowPasswordSheet(null);
    setClaimingDeposit(deposit);

    const success = await executeClaim({
      identifier: identity.handle,
      password,
      leafIndex: deposit.leafIndex,
    });

    if (success) {
      // Invalidate deposits query so it refetches with updated claimed status
      queryClient.invalidateQueries({ queryKey: depositKeys.byIdentity(identity.handle) });
    } else {
      setClaimingDeposit(null);
    }
  }, [showPasswordSheet, password, identity, executeClaim, queryClient]);

  // Handle claim from landing page (claim link flow)
  const handleLandingClaim = useCallback(async (landingPassword: string) => {
    if (!claimLinkData) return;

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
    setClaimingDeposit(syntheticDeposit);

    const success = await executeClaim({
      identifier: claimLinkData.identifier,
      password: landingPassword,
      leafIndex: claimLinkData.leafIndex,
      pool: claimLinkData.pool || POOL_ADDRESS.toBase58(),
    });

    if (success) {
      // Clean URL params after successful claim
      const url = new URL(window.location.href);
      url.searchParams.delete('id');
      url.searchParams.delete('leaf');
      url.searchParams.delete('pool');
      window.history.replaceState({}, '', url.toString());
    } else {
      setClaimingDeposit(null);
    }
  }, [claimLinkData, executeClaim]);

  // Reset after success
  const handleClaimComplete = useCallback(() => {
    reset();
    setClaimingDeposit(null);
  }, [reset]);

  // Switch identity — go back to picker without signing out
  const handleSwitchIdentity = useCallback(() => {
    setIdentity(null);
  }, []);

  // ─── RENDER ───────────────────────────────────────────────

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
        <OAuthLogin onLogin={handleLogin} loading={false} />
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
                    delay: 0.1,
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
        <button className="btn btn-ghost" onClick={handleSwitchIdentity} style={{ flexShrink: 0 }}>
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
            onSubmit={handleExecuteClaim}
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
