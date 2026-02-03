import type { FC } from 'react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

interface Props {
  wasmReady: boolean;
}

export const Header: FC<Props> = ({ wasmReady }) => {
  return (
    <header className="header">
      <h1>🐈‍⬛ Murkl</h1>
      
      <div className="header-right">
        {!wasmReady && (
          <span className="status-indicator loading" title="Loading prover...">
            ⏳
          </span>
        )}
        <WalletMultiButton />
      </div>
    </header>
  );
};
