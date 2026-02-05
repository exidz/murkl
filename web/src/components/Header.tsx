import { useMemo, type FC } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { motion, AnimatePresence } from 'framer-motion';
import { EXPLORER_CLUSTER } from '../lib/constants';
import './Header.css';

interface Props {
  wasmReady: boolean;
}

/**
 * Minimal Venmo-style header with:
 * - Logo + branding
 * - Network badge (devnet/mainnet)
 * - WASM status indicator
 * - Wallet button
 */
export const Header: FC<Props> = ({ wasmReady }) => {
  const { connected } = useWallet();
  
  // Derive network display
  const network = useMemo(() => {
    const cluster = EXPLORER_CLUSTER.toLowerCase();
    if (cluster === 'mainnet-beta' || cluster === 'mainnet') {
      return { label: 'mainnet', color: '#22c55e' };
    }
    if (cluster === 'devnet') {
      return { label: 'devnet', color: '#f59e0b' };
    }
    return { label: cluster, color: '#a1a1aa' };
  }, []);

  return (
    <header className="header">
      {/* Left: Logo */}
      <div className="header-brand">
        <motion.span 
          className="header-logo"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          aria-hidden="true"
        >
          🐈‍⬛
        </motion.span>
        <h1 className="header-title">Murkl</h1>
        
        {/* Network badge */}
        <span 
          className="network-badge"
          style={{ '--badge-color': network.color } as React.CSSProperties}
          aria-label={`Network: ${network.label}`}
        >
          {network.label}
        </span>
      </div>

      {/* Right: Status + Wallet */}
      <div className="header-actions">
        {/* WASM status */}
        <AnimatePresence mode="wait">
          {!wasmReady ? (
            <motion.div 
              key="loading"
              className="status-chip loading"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              title="Loading STARK prover..."
              role="status"
              aria-label="Loading STARK prover"
            >
              <span className="status-spinner" aria-hidden="true" />
              <span className="status-text">Prover</span>
            </motion.div>
          ) : connected && (
            <motion.div 
              key="ready"
              className="status-chip ready"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              title="STARK prover ready"
              role="status"
              aria-label="STARK prover ready"
            >
              <span className="status-dot" aria-hidden="true" />
              <span className="status-text">Ready</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Wallet button */}
        <WalletMultiButton />
      </div>
    </header>
  );
};

export default Header;
