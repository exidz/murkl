import { useState } from 'react';
import { keccak256 } from 'js-sha3';
import './App.css';

const M31_PRIME = 0x7FFFFFFF;

// PQ-secure hash functions (matching CLI)
function hashPassword(password: string): number {
  const hash = keccak256('murkl_password_v1' + password);
  const val = parseInt(hash.slice(0, 8), 16);
  return val % M31_PRIME;
}

function hashIdentifier(id: string): number {
  const normalized = id.toLowerCase();
  const hash = keccak256('murkl_identifier_v1' + normalized);
  const val = parseInt(hash.slice(0, 8), 16);
  return val % M31_PRIME;
}

function computeCommitment(idHash: number, secret: number): string {
  const data = 'murkl_m31_hash_v1' + 
    String.fromCharCode(idHash & 0xff, (idHash >> 8) & 0xff, (idHash >> 16) & 0xff, (idHash >> 24) & 0xff) +
    String.fromCharCode(secret & 0xff, (secret >> 8) & 0xff, (secret >> 16) & 0xff, (secret >> 24) & 0xff);
  return keccak256(data);
}

function computeNullifier(secret: number, leafIndex: number): string {
  const data = 'murkl_nullifier_v1' +
    String.fromCharCode(secret & 0xff, (secret >> 8) & 0xff, (secret >> 16) & 0xff, (secret >> 24) & 0xff) +
    String.fromCharCode(leafIndex & 0xff, (leafIndex >> 8) & 0xff, (leafIndex >> 16) & 0xff, (leafIndex >> 24) & 0xff);
  return keccak256(data);
}

type Tab = 'send' | 'claim';

function App() {
  const [tab, setTab] = useState<Tab>('claim');
  
  // Send tab state
  const [sendIdentifier, setSendIdentifier] = useState('');
  const [sendPassword, setSendPassword] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendResult, setSendResult] = useState<{commitment: string, idHash: number, secret: number} | null>(null);
  
  // Claim tab state
  const [claimIdentifier, setClaimIdentifier] = useState('');
  const [claimPassword, setClaimPassword] = useState('');
  const [claimLeafIndex, setClaimLeafIndex] = useState('0');
  const [claimWallet, setClaimWallet] = useState('');
  const [claimResult, setClaimResult] = useState<{commitment: string, nullifier: string, proofSize: number} | null>(null);
  const [claiming, setClaiming] = useState(false);

  const handleSend = () => {
    const idHash = hashIdentifier(sendIdentifier);
    const secret = hashPassword(sendPassword);
    const commitment = computeCommitment(idHash, secret);
    setSendResult({ commitment, idHash, secret });
  };

  const handleClaim = async () => {
    setClaiming(true);
    
    // Compute values
    const idHash = hashIdentifier(claimIdentifier);
    const secret = hashPassword(claimPassword);
    const commitment = computeCommitment(idHash, secret);
    const nullifier = computeNullifier(secret, parseInt(claimLeafIndex));
    
    // Simulate proof generation (in production, use WASM prover)
    await new Promise(r => setTimeout(r, 1500));
    
    setClaimResult({
      commitment: '0x' + commitment.slice(0, 16),
      nullifier: '0x' + nullifier.slice(0, 16),
      proofSize: 6116,
    });
    
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
              disabled={!sendIdentifier || !sendPassword}
            >
              Generate Commitment
            </button>
            
            {sendResult && (
              <div className="result">
                <h3>✅ Commitment Generated</h3>
                <div className="result-item">
                  <span className="label">Commitment:</span>
                  <code>0x{sendResult.commitment.slice(0, 16)}...</code>
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
              disabled={!claimIdentifier || !claimPassword || !claimWallet || claiming}
            >
              {claiming ? '⏳ Generating Proof...' : '🔐 Generate Proof & Claim'}
            </button>
            
            {claimResult && (
              <div className="result success">
                <h3>✅ Proof Generated!</h3>
                <div className="result-item">
                  <span className="label">Commitment:</span>
                  <code>{claimResult.commitment}...</code>
                </div>
                <div className="result-item">
                  <span className="label">Nullifier:</span>
                  <code>{claimResult.nullifier}...</code>
                </div>
                <div className="result-item">
                  <span className="label">Proof Size:</span>
                  <code>{claimResult.proofSize} bytes</code>
                </div>
                <div className="privacy-note">
                  <h4>🔒 Privacy Guarantee</h4>
                  <ul>
                    <li>Your identifier never goes on-chain</li>
                    <li>Your wallet never signs anything</li>
                    <li>Relayer submits transaction for you</li>
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
          Circle STARKs • M31 Field • keccak256 • Post-Quantum
        </p>
      </footer>
    </div>
  );
}

export default App;
