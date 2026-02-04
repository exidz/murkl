import { useState, useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
import { WalletProvider } from './providers/WalletProvider';
import { Header } from './components/Header';
import { SendTab } from './components/SendTab';
import { ClaimTabNew as ClaimTab } from './components/ClaimTabNew';
import './App.css';

// WASM module
import init from './wasm/murkl_wasm';

type Tab = 'send' | 'claim';

function AppContent() {
  const [wasmReady, setWasmReady] = useState(false);
  const [tab, setTab] = useState<Tab>('send');

  // Initialize WASM
  useEffect(() => {
    init().then(() => {
      setWasmReady(true);
      if (import.meta.env.DEV) {
        console.log('WASM prover ready');
      }
    }).catch((err) => {
      console.error('Failed to load WASM:', err);
    });
  }, []);

  // Check URL for claim params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('id') || params.has('leaf')) {
      setTab('claim');
    }
  }, []);

  return (
    <div className="app">
      <Header wasmReady={wasmReady} />

      <div className="tabs">
        <button 
          className={`tab ${tab === 'send' ? 'active' : ''}`}
          onClick={() => setTab('send')}
          aria-selected={tab === 'send'}
        >
          📤 Send
        </button>
        <button 
          className={`tab ${tab === 'claim' ? 'active' : ''}`}
          onClick={() => setTab('claim')}
          aria-selected={tab === 'claim'}
        >
          📥 Claim
        </button>
      </div>

      <main className="content">
        {tab === 'send' && <SendTab wasmReady={wasmReady} />}
        {tab === 'claim' && <ClaimTab wasmReady={wasmReady} />}
      </main>

      <footer className="footer">
        <p>
          Private payments, built in-browser 🐈‍⬛
        </p>
        <p className="tech">
          <a href="https://github.com/exidz/murkl" target="_blank" rel="noopener noreferrer">Source</a>
          {' • '}
          <a href="https://colosseum.org" target="_blank" rel="noopener noreferrer">Colosseum</a>
        </p>
      </footer>
    </div>
  );
}

function App() {
  return (
    <WalletProvider>
      <AppContent />
      <Toaster 
        position="top-right"
        toastOptions={{
          duration: 4000,
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
  );
}

export default App;
