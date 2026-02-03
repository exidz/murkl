import { useState, useEffect } from 'react';
import './App.css';

// WASM module
import init, { 
  generate_commitment, 
  generate_proof,
} from './wasm/murkl_wasm';

type Tab = 'send' | 'claim';

function App() {
  const [wasmReady, setWasmReady] = useState(false);
  const [tab, setTab] = useState<Tab>('claim');
  
  // Send tab state
  const [sendIdentifier, setSendIdentifier] = useState('');
  const [sendPassword, setSendPassword] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendResult, setSendResult] = useState<{commitment: string} | null>(null);
  
  // Claim tab state
  const [claimIdentifier, setClaimIdentifier] = useState('');
  const [claimPassword, setClaimPassword] = useState('');
  const [claimLeafIndex, setClaimLeafIndex] = useState('0');
  const [claimWallet, setClaimWallet] = useState('');
  const [claimResult, setClaimResult] = useState<any>(null);
  const [claiming, setClaiming] = useState(false);
  const [relayerStatus, setRelayerStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');

  // Initialize WASM
  useEffect(() => {
    init().then(() => {
      setWasmReady(true);
      console.log('🐈‍⬛ WASM prover ready!');
    });
  }, []);

  const handleSend = () => {
    if (!wasmReady) return;
    
    const commitment = generate_commitment(sendIdentifier, sendPassword);
    setSendResult({ commitment: '0x' + commitment.slice(0, 32) + '...' });
  };

  const handleClaim = async () => {
    if (!wasmReady) return;
    
    setClaiming(true);
    setRelayerStatus('idle');
    
    try {
      // Generate proof using WASM
      const proofBundle = generate_proof(
        claimIdentifier, 
        claimPassword, 
        parseInt(claimLeafIndex)
      );
      
      setClaimResult(proofBundle);
      
      // Submit to relayer
      setRelayerStatus('submitting');
      
      const relayerUrl = import.meta.env.VITE_RELAYER_URL || 'http://localhost:3001';
      
      const response = await fetch(`${relayerUrl}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proof: proofBundle.proof,
          commitment: proofBundle.commitment,
          nullifier: proofBundle.nullifier,
          leafIndex: proofBundle.leaf_index,
          recipientTokenAccount: claimWallet,
          poolAddress: import.meta.env.VITE_POOL_ADDRESS || '',
          depositAddress: import.meta.env.VITE_DEPOSIT_ADDRESS || '',
          feeBps: 50
        })
      });
      
      if (response.ok) {
        const result = await response.json();
        setClaimResult({ ...proofBundle, tx: result });
        setRelayerStatus('success');
      } else {
        const error = await response.json();
        setClaimResult({ ...proofBundle, error });
        setRelayerStatus('error');
      }
      
    } catch (e: any) {
      console.error('Claim error:', e);
      setRelayerStatus('error');
    }
    
    setClaiming(false);
  };

  return (
    <div className="app">
      <header className="header">
        <h1>🐈‍⬛ Murkl</h1>
        <p className="subtitle">Anonymous Social Transfers on Solana</p>
        <div className="badges">
          <span className="badge pq">🛡️ Post-Quantum</span>
          <span className="badge stark">⚡ Circle STARKs</span>
          <span className={`badge ${wasmReady ? 'wasm-ready' : 'wasm-loading'}`}>
            {wasmReady ? '✅ WASM Ready' : '⏳ Loading...'}
          </span>
        </div>
      </header>

      <div className="tabs">
        <button 
          className={`tab ${tab === 'send' ? 'active' : ''}`}
          onClick={() => setTab('send')}
        >
          📤 Send
        </button>
        <button 
          className={`tab ${tab === 'claim' ? 'active' : ''}`}
          onClick={() => setTab('claim')}
        >
          📥 Claim
        </button>
      </div>

      <main className="content">
        {tab === 'send' && (
          <div className="card">
            <h2>Send Tokens</h2>
            <p className="description">
              Send tokens to anyone using their social identifier.
              Share the password with them out-of-band.
            </p>
            
            <div className="form-group">
              <label>Recipient Identifier</label>
              <input 
                type="text"
                placeholder="@twitter, email, discord..."
                value={sendIdentifier}
                onChange={e => setSendIdentifier(e.target.value)}
              />
            </div>
            
            <div className="form-group">
              <label>Password</label>
              <input 
                type="text"
                placeholder="Create a password to share"
                value={sendPassword}
                onChange={e => setSendPassword(e.target.value)}
              />
              <span className="hint">Share this with the recipient (Signal, call, etc.)</span>
            </div>
            
            <div className="form-group">
              <label>Amount</label>
              <input 
                type="number"
                placeholder="100"
                value={sendAmount}
                onChange={e => setSendAmount(e.target.value)}
              />
            </div>
            
            <button 
              className="primary-btn"
              onClick={handleSend}
              disabled={!sendIdentifier || !sendPassword || !wasmReady}
            >
              Generate Commitment
            </button>
            
            {sendResult && (
              <div className="result">
                <h3>✅ Commitment Generated</h3>
                <div className="result-item">
                  <span className="label">Commitment:</span>
                  <code>{sendResult.commitment}</code>
                </div>
                <div className="next-steps">
                  <h4>Next Steps:</h4>
                  <ol>
                    <li>Deposit tokens with this commitment</li>
                    <li>Share password "{sendPassword}" with recipient</li>
                    <li>Tell them to claim at murkl.app</li>
                  </ol>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'claim' && (
          <div className="card">
            <h2>Claim Tokens</h2>
            <p className="description">
              Enter your identifier and the password from the sender.
              Your wallet will receive tokens without signing anything.
            </p>
            
            <div className="form-group">
              <label>Your Identifier</label>
              <input 
                type="text"
                placeholder="@twitter, email, discord..."
                value={claimIdentifier}
                onChange={e => setClaimIdentifier(e.target.value)}
              />
            </div>
            
            <div className="form-group">
              <label>Password</label>
              <input 
                type="password"
                placeholder="Password from sender"
                value={claimPassword}
                onChange={e => setClaimPassword(e.target.value)}
              />
            </div>
            
            <div className="form-group">
              <label>Leaf Index</label>
              <input 
                type="number"
                placeholder="0"
                value={claimLeafIndex}
                onChange={e => setClaimLeafIndex(e.target.value)}
              />
              <span className="hint">Check your deposit notification for this</span>
            </div>
            
            <div className="form-group">
              <label>Your Wallet Address</label>
              <input 
                type="text"
                placeholder="Your Solana wallet address"
                value={claimWallet}
                onChange={e => setClaimWallet(e.target.value)}
              />
              <span className="hint">Where to receive tokens (no signing needed!)</span>
            </div>
            
            <button 
              className="primary-btn"
              onClick={handleClaim}
              disabled={!claimIdentifier || !claimPassword || !claimWallet || claiming || !wasmReady}
            >
              {claiming ? '⏳ Generating Proof...' : '🔐 Generate Proof & Claim'}
            </button>
            
            {claimResult && (
              <div className={`result ${relayerStatus === 'success' ? 'success' : ''}`}>
                <h3>
                  {relayerStatus === 'success' ? '✅ Tokens Claimed!' : 
                   relayerStatus === 'error' ? '⚠️ Proof Generated (Relayer Error)' :
                   relayerStatus === 'submitting' ? '⏳ Submitting to Relayer...' :
                   '✅ Proof Generated!'}
                </h3>
                <div className="result-item">
                  <span className="label">Commitment:</span>
                  <code>0x{claimResult.commitment?.slice(0, 16)}...</code>
                </div>
                <div className="result-item">
                  <span className="label">Nullifier:</span>
                  <code>0x{claimResult.nullifier?.slice(0, 16)}...</code>
                </div>
                <div className="result-item">
                  <span className="label">Proof Size:</span>
                  <code>{claimResult.proof_size} bytes</code>
                </div>
                
                {claimResult.tx?.signature && (
                  <div className="result-item">
                    <span className="label">Transaction:</span>
                    <a 
                      href={claimResult.tx.explorer} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="tx-link"
                    >
                      {claimResult.tx.signature.slice(0, 16)}...
                    </a>
                  </div>
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
        )}
      </main>

      <footer className="footer">
        <p>
          Built for <a href="https://colosseum.org">Colosseum Hackathon</a> 🏛️
        </p>
        <p className="tech">
          Circle STARKs • M31 Field • keccak256 • Post-Quantum • WASM Prover
        </p>
      </footer>
    </div>
  );
}

export default App;
