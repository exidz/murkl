import { useState, useCallback, useEffect } from 'react';
import type { FC } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import toast from 'react-hot-toast';
import { parseShareLink } from '../lib/deposit';
import { isValidIdentifier, isValidPassword, isValidSolanaAddress, isValidLeafIndex, sanitizeInput } from '../lib/validation';
import { POOL_ADDRESS, RELAYER_URL, getExplorerUrl, FEE_BPS } from '../lib/constants';

// WASM imports
import { generate_proof } from '../wasm/murkl_wasm';

interface Props {
  wasmReady: boolean;
}

type ClaimStatus = 'idle' | 'generating' | 'submitting' | 'success' | 'error';

interface ClaimResult {
  commitment?: string;
  nullifier?: string;
  proof?: string;
  proof_size?: number;
  leaf_index?: number;
  error?: string;
  tx?: {
    signature: string;
    explorer?: string;
  };
}

export const ClaimTab: FC<Props> = ({ wasmReady }) => {
  const { connected, publicKey } = useWallet();
  
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [leafIndex, setLeafIndex] = useState('0');
  const [wallet, setWallet] = useState('');
  const [shareLink, setShareLink] = useState('');
  
  const [status, setStatus] = useState<ClaimStatus>('idle');
  const [result, setResult] = useState<ClaimResult | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);

  // Auto-fill wallet when connected
  useEffect(() => {
    if (connected && publicKey && !wallet) {
      setWallet(publicKey.toBase58());
    }
  }, [connected, publicKey, wallet]);

  // Parse share link
  const handlePasteLink = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      const parsed = parseShareLink(text);
      
      if (parsed) {
        setIdentifier(parsed.identifier);
        setLeafIndex(parsed.leafIndex.toString());
        setShareLink(text);
        toast.success('Share link parsed!');
      } else {
        toast.error('Invalid share link');
      }
    } catch {
      toast.error('Failed to read clipboard');
    }
  }, []);

  // Handle share link input change
  const handleShareLinkChange = useCallback((value: string) => {
    setShareLink(value);
    const parsed = parseShareLink(value);
    if (parsed) {
      setIdentifier(parsed.identifier);
      setLeafIndex(parsed.leafIndex.toString());
    }
  }, []);

  // Validate inputs
  const validateInputs = useCallback((): string | null => {
    if (!isValidIdentifier(identifier)) {
      return 'Identifier must be 1-256 characters';
    }
    if (!isValidPassword(password)) {
      return `Password must be 8-128 characters`;
    }
    if (!isValidLeafIndex(leafIndex)) {
      return 'Invalid leaf index';
    }
    if (!isValidSolanaAddress(wallet)) {
      return 'Invalid Solana wallet address';
    }
    return null;
  }, [identifier, password, leafIndex, wallet]);

  // Handle claim
  const handleClaim = useCallback(async () => {
    const validationError = validateInputs();
    if (validationError) {
      toast.error(validationError);
      return;
    }
    
    setStatus('generating');
    setResult(null);
    setShowConfetti(false);
    
    try {
      const cleanIdentifier = sanitizeInput(identifier);
      const leafIndexNum = parseInt(leafIndex, 10);
      
      // Generate proof using WASM
      toast.loading('Generating STARK proof...', { id: 'proof' });
      const proofBundle = generate_proof(cleanIdentifier, password, leafIndexNum);
      toast.dismiss('proof');
      
      if (!proofBundle || !proofBundle.commitment) {
        throw new Error('Proof generation failed');
      }
      
      setResult(proofBundle);
      
      // Submit to relayer
      setStatus('submitting');
      toast.loading('Submitting to relayer...', { id: 'submit' });
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000);
      
      const response = await fetch(`${RELAYER_URL}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          proof: proofBundle.proof,
          commitment: proofBundle.commitment,
          nullifier: proofBundle.nullifier,
          leafIndex: proofBundle.leaf_index,
          recipientTokenAccount: wallet,
          poolAddress: POOL_ADDRESS.toBase58(),
          depositAddress: import.meta.env.VITE_DEPOSIT_ADDRESS || '',
          feeBps: FEE_BPS
        })
      });
      
      clearTimeout(timeoutId);
      toast.dismiss('submit');
      
      if (response.ok) {
        const txResult = await response.json();
        setResult({ 
          ...proofBundle, 
          tx: {
            signature: txResult.signature,
            explorer: getExplorerUrl(txResult.signature)
          }
        });
        setStatus('success');
        setShowConfetti(true);
        toast.success('🎉 Tokens claimed successfully!');
        
        // Hide confetti after animation
        setTimeout(() => setShowConfetti(false), 5000);
      } else {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Claim failed');
      }
      
    } catch (error) {
      console.error('Claim error:', error);
      
      if (error instanceof Error && error.name === 'AbortError') {
        toast.error('Request timed out. Please try again.');
      } else if (error instanceof Error && error.message.includes('fetch')) {
        toast.error('Relayer unavailable. Proof generated successfully - try again later.');
      } else {
        toast.error(error instanceof Error ? error.message : 'Claim failed');
      }
      
      setStatus('error');
    }
  }, [identifier, password, leafIndex, wallet, validateInputs]);

  // Reset form
  const handleReset = useCallback(() => {
    setIdentifier('');
    setPassword('');
    setLeafIndex('0');
    setWallet(publicKey?.toBase58() || '');
    setShareLink('');
    setResult(null);
    setStatus('idle');
    setShowConfetti(false);
  }, [publicKey]);

  const isLoading = status === 'generating' || status === 'submitting';

  return (
    <div className="card">
      {showConfetti && (
        <div className="confetti-container">
          {[...Array(50)].map((_, i) => (
            <div key={i} className="confetti" style={{
              left: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 2}s`,
              backgroundColor: ['#8b5cf6', '#ec4899', '#22c55e', '#3b82f6', '#f59e0b'][Math.floor(Math.random() * 5)]
            }} />
          ))}
        </div>
      )}
      
      <h2>📥 Claim Tokens</h2>
      <p className="description">
        Enter your identifier and the password from the sender.
        No wallet signature needed - just enter your address!
      </p>
      
      {/* Share Link Paste */}
      <div className="form-group">
        <label>Quick Fill (paste share link)</label>
        <div className="input-with-btn">
          <input 
            type="text"
            placeholder="Paste share link here..."
            value={shareLink}
            onChange={e => handleShareLinkChange(e.target.value)}
            disabled={isLoading}
          />
          <button 
            type="button"
            className="input-btn"
            onClick={handlePasteLink}
            disabled={isLoading}
            title="Paste from clipboard"
          >
            📋
          </button>
        </div>
      </div>
      
      <div className="divider">
        <span>or enter manually</span>
      </div>
      
      <div className="form-group">
        <label htmlFor="claim-identifier">Your Identifier</label>
        <input 
          id="claim-identifier"
          type="text"
          placeholder="@twitter, email, discord..."
          value={identifier}
          onChange={e => setIdentifier(e.target.value)}
          maxLength={256}
          autoComplete="off"
          spellCheck={false}
          disabled={isLoading}
        />
      </div>
      
      <div className="form-group">
        <label htmlFor="claim-password">Password</label>
        <input 
          id="claim-password"
          type="password"
          placeholder="Password from sender"
          value={password}
          onChange={e => setPassword(e.target.value)}
          maxLength={128}
          autoComplete="off"
          disabled={isLoading}
        />
      </div>
      
      <div className="form-group">
        <label htmlFor="claim-leaf-index">Leaf Index</label>
        <input 
          id="claim-leaf-index"
          type="number"
          placeholder="0"
          value={leafIndex}
          onChange={e => setLeafIndex(e.target.value)}
          min="0"
          step="1"
          disabled={isLoading}
        />
        <span className="hint">From your deposit notification or share link</span>
      </div>
      
      <div className="form-group">
        <label htmlFor="claim-wallet">Your Wallet Address</label>
        <input 
          id="claim-wallet"
          type="text"
          placeholder="Your Solana wallet address"
          value={wallet}
          onChange={e => setWallet(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          disabled={isLoading}
        />
        <span className="hint">Where to receive tokens (no signing needed!)</span>
        {connected && !wallet && (
          <button 
            type="button" 
            className="text-btn"
            onClick={() => setWallet(publicKey?.toBase58() || '')}
          >
            Use connected wallet
          </button>
        )}
      </div>
      
      <button 
        className="primary-btn"
        onClick={handleClaim}
        disabled={!identifier || !password || !wallet || isLoading || !wasmReady}
      >
        {status === 'generating' ? '⏳ Generating Proof...' :
         status === 'submitting' ? '📡 Submitting to Relayer...' :
         '🔐 Generate Proof & Claim'}
      </button>
      
      {result && (
        <div className={`result ${status === 'success' ? 'success' : status === 'error' ? 'error' : ''}`}>
          <h3>
            {result.error ? '❌ Error' :
             status === 'success' ? '🎉 Tokens Claimed!' : 
             status === 'error' ? '⚠️ Proof Generated (Submission Failed)' :
             status === 'submitting' ? '⏳ Submitting to Relayer...' :
             '✅ Proof Generated!'}
          </h3>
          
          {result.error ? (
            <div className="result-item">
              <span className="label">Error:</span>
              <code>{result.error}</code>
            </div>
          ) : (
            <>
              <div className="result-item">
                <span className="label">Commitment:</span>
                <code>0x{result.commitment?.slice(0, 16)}...</code>
              </div>
              <div className="result-item">
                <span className="label">Nullifier:</span>
                <code>0x{result.nullifier?.slice(0, 16)}...</code>
              </div>
              <div className="result-item">
                <span className="label">Proof Size:</span>
                <code>{result.proof_size} bytes</code>
              </div>
            </>
          )}
          
          {result.tx?.signature && (
            <div className="result-item highlight">
              <span className="label">Transaction:</span>
              <a 
                href={result.tx.explorer} 
                target="_blank" 
                rel="noopener noreferrer"
                className="tx-link"
              >
                View on Explorer →
              </a>
            </div>
          )}
          
          {status === 'success' && (
            <button className="secondary-btn" onClick={handleReset}>
              ✨ Claim Another
            </button>
          )}
          
          <div className="privacy-note">
            <h4>🔒 Privacy Guarantee</h4>
            <ul>
              <li>Your identifier never goes on-chain</li>
              <li>Your wallet never signs anything</li>
              <li>Relayer submits transaction for you</li>
              <li>STARK proof computed locally in WASM</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};
