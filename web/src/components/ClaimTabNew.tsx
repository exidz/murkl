import { useState, useCallback } from 'react';
import type { FC } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import toast from 'react-hot-toast';
import { OAuthLogin } from './OAuthLogin';
import { RELAYER_URL, getExplorerUrl } from '../lib/constants';
import './ClaimTabNew.css';

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

type ClaimStatus = 'idle' | 'generating' | 'submitting' | 'success' | 'error';

export const ClaimTabNew: FC<Props> = ({ wasmReady }) => {
  const { connected, publicKey } = useWallet();
  
  // Auth state
  const [identity, setIdentity] = useState<{ provider: string; handle: string } | null>(null);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [loadingDeposits, setLoadingDeposits] = useState(false);
  
  // Claim state
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [status, setStatus] = useState<ClaimStatus>('idle');
  const [password, setPassword] = useState('');
  const [showPasswordModal, setShowPasswordModal] = useState<Deposit | null>(null);

  // Handle OAuth login
  const handleLogin = useCallback(async (provider: string, handle: string) => {
    setIdentity({ provider, handle });
    setLoadingDeposits(true);
    
    try {
      // Fetch deposits for this identity from relayer
      const response = await fetch(`${RELAYER_URL}/deposits?identity=${encodeURIComponent(handle)}`);
      
      if (response.ok) {
        const data = await response.json();
        setDeposits(data.deposits || []);
        
        if (data.deposits?.length === 0) {
          toast('No deposits found for this identity', { icon: '📭' });
        } else {
          toast.success(`Found ${data.deposits.length} deposit(s)!`);
        }
      } else {
        // Demo mode: show mock deposits
        setDeposits([
          {
            id: '1',
            amount: 0.1,
            token: 'SOL',
            leafIndex: 1,
            timestamp: new Date().toISOString(),
            claimed: false,
          },
        ]);
        toast.success('Demo: Found 1 deposit');
      }
    } catch (error) {
      // Demo mode fallback
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

  // Handle claim
  const handleClaim = useCallback(async (deposit: Deposit) => {
    if (!wasmReady) {
      toast.error('WASM prover not ready');
      return;
    }

    if (!connected || !publicKey) {
      toast.error('Please connect your wallet first');
      return;
    }

    if (!password) {
      setShowPasswordModal(deposit);
      return;
    }

    setClaimingId(deposit.id);
    setStatus('generating');

    try {
      toast.loading('Generating STARK proof...', { id: 'claim' });

      // Generate proof using WASM
      const proofResult = await generate_proof(
        identity!.handle,
        password,
        deposit.leafIndex
      );

      if (proofResult.error) {
        throw new Error(proofResult.error);
      }

      setStatus('submitting');
      toast.loading('Submitting claim...', { id: 'claim' });

      // Submit to relayer
      const response = await fetch(`${RELAYER_URL}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proof: proofResult.proof,
          commitment: proofResult.commitment,
          nullifier: proofResult.nullifier,
          recipient: publicKey.toBase58(),
          leafIndex: deposit.leafIndex,
        }),
      });

      if (!response.ok) {
        throw new Error('Claim submission failed');
      }

      const result = await response.json();
      
      setStatus('success');
      toast.success('Claim successful! 🎉', { id: 'claim' });

      // Update deposit as claimed
      setDeposits(prev => 
        prev.map(d => d.id === deposit.id ? { ...d, claimed: true } : d)
      );

      // Show confetti or success animation
      if (result.signature) {
        toast(
          <div>
            <p>View on explorer:</p>
            <a href={getExplorerUrl(result.signature)} target="_blank" rel="noopener">
              {result.signature.slice(0, 20)}...
            </a>
          </div>,
          { duration: 10000 }
        );
      }
    } catch (error: any) {
      setStatus('error');
      toast.error(error.message || 'Claim failed', { id: 'claim' });
    } finally {
      setClaimingId(null);
      setPassword('');
      setShowPasswordModal(null);
    }
  }, [wasmReady, connected, publicKey, identity, password]);

  // Handle logout
  const handleLogout = () => {
    setIdentity(null);
    setDeposits([]);
  };

  // If not logged in, show OAuth
  if (!identity) {
    return (
      <div className="claim-tab-new">
        <OAuthLogin onLogin={handleLogin} loading={loadingDeposits} />
        
        <div className="manual-claim">
          <details>
            <summary>Have a share link?</summary>
            <div className="manual-form">
              <input 
                type="text" 
                placeholder="Paste share link or enter identifier..."
                className="input"
              />
              <button className="btn btn-secondary">Continue</button>
            </div>
          </details>
        </div>
      </div>
    );
  }

  // Logged in - show deposits
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
          Switch account
        </button>
      </div>

      {/* Deposits list */}
      <div className="deposits-section">
        <h3>Your Deposits</h3>
        
        {loadingDeposits ? (
          <div className="loading">
            <div className="spinner" />
            <p>Checking for deposits...</p>
          </div>
        ) : deposits.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">📭</span>
            <p>No deposits found</p>
            <p className="empty-hint">
              Ask someone to send you tokens via Murkl!
            </p>
          </div>
        ) : (
          <div className="deposits-list">
            {deposits.map(deposit => (
              <div 
                key={deposit.id} 
                className={`deposit-card ${deposit.claimed ? 'claimed' : ''}`}
              >
                <div className="deposit-info">
                  <div className="deposit-amount">
                    {deposit.amount} {deposit.token}
                  </div>
                  <div className="deposit-meta">
                    {new Date(deposit.timestamp).toLocaleDateString()}
                  </div>
                </div>
                
                <div className="deposit-actions">
                  {deposit.claimed ? (
                    <span className="claimed-badge">✓ Claimed</span>
                  ) : (
                    <button
                      className="btn btn-primary"
                      onClick={() => handleClaim(deposit)}
                      disabled={claimingId === deposit.id || !connected}
                    >
                      {claimingId === deposit.id ? (
                        <>
                          <span className="spinner-small" />
                          {status === 'generating' ? 'Proving...' : 'Claiming...'}
                        </>
                      ) : (
                        'Claim'
                      )}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Password modal */}
      {showPasswordModal && (
        <div className="modal-overlay" onClick={() => setShowPasswordModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>🔑 Enter Password</h3>
            <p>Enter the password the sender shared with you</p>
            <input
              type="password"
              className="input"
              placeholder="Password..."
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoFocus
            />
            <div className="modal-actions">
              <button 
                className="btn btn-ghost"
                onClick={() => setShowPasswordModal(null)}
              >
                Cancel
              </button>
              <button 
                className="btn btn-primary"
                onClick={() => handleClaim(showPasswordModal)}
                disabled={!password}
              >
                Claim
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Wallet connection reminder */}
      {!connected && (
        <div className="wallet-reminder">
          <p>👛 Connect your wallet to receive tokens</p>
        </div>
      )}
    </div>
  );
};

export default ClaimTabNew;
