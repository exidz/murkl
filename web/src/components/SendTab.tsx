import { useState, useCallback } from 'react';
import type { FC } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { QRCodeSVG } from 'qrcode.react';
import toast from 'react-hot-toast';
import { buildDepositTransaction, generatePassword, createShareLink } from '../lib/deposit';
import { isValidIdentifier, isValidPassword, isValidAmount, sanitizeInput } from '../lib/validation';
import { POOL_ADDRESS, getExplorerUrl } from '../lib/constants';

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

export const SendTab: FC<Props> = ({ wasmReady }) => {
  const { connected, publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<DepositSuccess | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Validate inputs
  const validateInputs = useCallback((): string | null => {
    if (!isValidIdentifier(identifier)) {
      return 'Identifier must be 1-256 characters';
    }
    if (!isValidPassword(password)) {
      return `Password must be 8-128 characters`;
    }
    if (!isValidAmount(amount)) {
      return 'Amount must be a positive number';
    }
    return null;
  }, [identifier, password, amount]);

  // Auto-generate password
  const handleGeneratePassword = useCallback(() => {
    const newPassword = generatePassword(16);
    setPassword(newPassword);
    setShowPassword(true);
  }, []);

  // Copy to clipboard
  const copyToClipboard = useCallback(async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      toast.success(`${field} copied!`);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  }, []);

  // Handle deposit
  const handleDeposit = useCallback(async () => {
    if (!connected || !publicKey || !signTransaction) {
      toast.error('Please connect your wallet');
      return;
    }
    
    const validationError = validateInputs();
    if (validationError) {
      toast.error(validationError);
      return;
    }
    
    setLoading(true);
    setSuccess(null);
    
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
      toast.loading('Please sign the transaction...', { id: 'signing' });
      const signed = await signTransaction(depositResult.transaction);
      toast.dismiss('signing');
      
      // Send transaction
      toast.loading('Sending transaction...', { id: 'sending' });
      const signature = await connection.sendRawTransaction(signed.serialize());
      
      // Confirm transaction
      toast.loading('Confirming transaction...', { id: 'sending' });
      await connection.confirmTransaction({
        blockhash,
        lastValidBlockHeight,
        signature,
      }, 'confirmed');
      toast.dismiss('sending');
      
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
      
      toast.success('Deposit successful!');
      
    } catch (error) {
      console.error('Deposit error:', error);
      toast.error(error instanceof Error ? error.message : 'Deposit failed');
    } finally {
      setLoading(false);
    }
  }, [connected, publicKey, signTransaction, connection, identifier, password, amount, validateInputs]);

  // Reset form
  const handleNewDeposit = useCallback(() => {
    setSuccess(null);
    setIdentifier('');
    setPassword('');
    setAmount('');
    setShowPassword(false);
  }, []);

  if (!connected) {
    return (
      <div className="card">
        <div className="connect-prompt">
          <h2>🔐 Connect Wallet to Send</h2>
          <p>Connect your Solana wallet to make a deposit and send tokens anonymously.</p>
          <div className="wallet-features">
            <div className="feature">
              <span className="feature-icon">🔒</span>
              <span>Privacy-preserving deposits</span>
            </div>
            <div className="feature">
              <span className="feature-icon">⚡</span>
              <span>Recipient doesn't need to sign</span>
            </div>
            <div className="feature">
              <span className="feature-icon">🛡️</span>
              <span>Post-quantum secure</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="card success-card">
        <div className="success-header">
          <span className="success-icon">✅</span>
          <h2>Deposit Successful!</h2>
        </div>
        
        <div className="success-details">
          <div className="detail-row">
            <span className="label">Amount:</span>
            <span className="value">{success.amount} tokens</span>
          </div>
          <div className="detail-row">
            <span className="label">Recipient:</span>
            <span className="value">{success.identifier}</span>
          </div>
          <div className="detail-row">
            <span className="label">Leaf Index:</span>
            <span className="value">{success.leafIndex}</span>
          </div>
          <div className="detail-row">
            <span className="label">Transaction:</span>
            <a 
              href={getExplorerUrl(success.signature)} 
              target="_blank" 
              rel="noopener noreferrer"
              className="tx-link"
            >
              {success.signature.slice(0, 16)}...
            </a>
          </div>
        </div>
        
        <div className="share-section">
          <h3>📨 Share with Recipient</h3>
          <p className="share-description">
            Send the password securely (call, Signal, etc). The recipient needs:
          </p>
          
          <div className="share-item">
            <label>Password (keep secret!):</label>
            <div className="copy-field">
              <code>{showPassword ? success.password : '••••••••••••••••'}</code>
              <button 
                className="icon-btn"
                onClick={() => setShowPassword(!showPassword)}
                title={showPassword ? 'Hide' : 'Show'}
              >
                {showPassword ? '👁️' : '👁️‍🗨️'}
              </button>
              <button 
                className="icon-btn"
                onClick={() => copyToClipboard(success.password, 'Password')}
                title="Copy"
              >
                {copiedField === 'Password' ? '✓' : '📋'}
              </button>
            </div>
          </div>
          
          <div className="share-item">
            <label>Share Link:</label>
            <div className="copy-field">
              <code className="link">{success.shareLink}</code>
              <button 
                className="icon-btn"
                onClick={() => copyToClipboard(success.shareLink, 'Link')}
                title="Copy"
              >
                {copiedField === 'Link' ? '✓' : '📋'}
              </button>
            </div>
          </div>
          
          <div className="qr-section">
            <p>Or scan QR code:</p>
            <div className="qr-code">
              <QRCodeSVG 
                value={success.shareLink} 
                size={180}
                bgColor="#1a1a24"
                fgColor="#ffffff"
              />
            </div>
          </div>
        </div>
        
        <button className="primary-btn" onClick={handleNewDeposit}>
          ➕ Make Another Deposit
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>📤 Send Tokens</h2>
      <p className="description">
        Send tokens to anyone using their social identifier.
        They'll claim without revealing their identity on-chain.
      </p>
      
      <div className="form-group">
        <label htmlFor="send-identifier">Recipient Identifier</label>
        <input 
          id="send-identifier"
          type="text"
          placeholder="@twitter, email, discord..."
          value={identifier}
          onChange={e => setIdentifier(e.target.value)}
          maxLength={256}
          autoComplete="off"
          spellCheck={false}
          disabled={loading}
        />
        <span className="hint">Their social handle or email - only they can claim</span>
      </div>
      
      <div className="form-group">
        <label htmlFor="send-password">Password</label>
        <div className="input-with-btn">
          <input 
            id="send-password"
            type={showPassword ? 'text' : 'password'}
            placeholder="Create a password to share"
            value={password}
            onChange={e => setPassword(e.target.value)}
            maxLength={128}
            autoComplete="new-password"
            disabled={loading}
          />
          <button 
            type="button"
            className="input-btn"
            onClick={() => setShowPassword(!showPassword)}
            disabled={loading}
          >
            {showPassword ? '👁️' : '👁️‍🗨️'}
          </button>
          <button 
            type="button"
            className="input-btn generate"
            onClick={handleGeneratePassword}
            disabled={loading}
            title="Generate random password"
          >
            🎲
          </button>
        </div>
        <span className="hint">Share this with the recipient securely (Signal, call, etc.)</span>
      </div>
      
      <div className="form-group">
        <label htmlFor="send-amount">Amount</label>
        <input 
          id="send-amount"
          type="number"
          placeholder="100"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          min="0.000000001"
          step="any"
          disabled={loading}
        />
        <span className="hint">Tokens to send (will be deducted from your wallet)</span>
      </div>
      
      <button 
        className="primary-btn"
        onClick={handleDeposit}
        disabled={!identifier || !password || !amount || loading || !wasmReady}
      >
        {loading ? '⏳ Processing...' : '🚀 Send Tokens'}
      </button>
      
      <div className="privacy-note">
        <h4>🔒 How it works</h4>
        <ul>
          <li>Your deposit creates a commitment on-chain</li>
          <li>Only identifier + password reveals the secret</li>
          <li>Recipient proves knowledge without revealing identity</li>
          <li>STARK proof ensures zero-knowledge guarantee</li>
        </ul>
      </div>
    </div>
  );
};
