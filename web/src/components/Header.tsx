import type { FC } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

interface Props {
  wasmReady: boolean;
}

export const Header: FC<Props> = ({ wasmReady }) => {
  const { connected, publicKey } = useWallet();

  return (
    <header className="header">
      <div className="header-top">
        <h1>🐈‍⬛ Murkl</h1>
        <WalletMultiButton />
      </div>
      <p className="subtitle">Anonymous Social Transfers on Solana</p>
      
      <div className="badges">
        <span className="badge pq">🛡️ Post-Quantum</span>
        <span className="badge stark">⚡ Circle STARKs</span>
        <span className={`badge ${wasmReady ? 'wasm-ready' : 'wasm-loading'}`}>
          {wasmReady ? '✅ WASM Ready' : '⏳ Loading...'}
        </span>
        {connected && publicKey && (
          <span className="badge wallet-connected">
            🔗 {publicKey.toBase58().slice(0, 4)}...{publicKey.toBase58().slice(-4)}
          </span>
        )}
      </div>
    </header>
  );
};
