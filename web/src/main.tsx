import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HeroUIProvider } from '@heroui/react';
import { WalletProvider } from './providers/WalletProvider';
import { Toaster } from 'react-hot-toast';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HeroUIProvider>
      <WalletProvider>
        <App />
        <Toaster 
          position="bottom-center"
          toastOptions={{
            style: {
              background: '#1a1a24',
              color: '#fff',
              border: '1px solid #2a2a3a',
            },
            success: {
              iconTheme: {
                primary: '#22c55e',
                secondary: '#fff',
              },
            },
            error: {
              iconTheme: {
                primary: '#ef4444',
                secondary: '#fff',
              },
            },
          }}
        />
      </WalletProvider>
    </HeroUIProvider>
  </StrictMode>,
);
