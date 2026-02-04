import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { WalletProvider } from './providers/WalletProvider';
import { Header } from './components/Header';
import { SendTab } from './components/SendTab';
import { ClaimTabNew as ClaimTab } from './components/ClaimTabNew';
import { TabBar } from './components/TabBar';
import { Footer } from './components/Footer';
import { SplashScreen } from './components/SplashScreen';
import { ToastContainer } from './components/Toast';
import './App.css';

// WASM module
import init from './wasm/murkl_wasm';

type Tab = 'send' | 'claim';

// Tab configuration
const TABS = [
  { id: 'send', label: 'Send', icon: '📤' },
  { id: 'claim', label: 'Claim', icon: '📥' },
] as const;

// Minimum splash duration (ms) — prevents flicker on fast loads
const MIN_SPLASH_MS = 800;

// Page transition variants - Venmo-style smooth slide
const pageVariants = {
  initial: (direction: number) => ({
    x: direction > 0 ? 60 : -60,
    opacity: 0,
  }),
  animate: {
    x: 0,
    opacity: 1,
    transition: {
      x: { type: 'spring' as const, stiffness: 300, damping: 30 },
      opacity: { duration: 0.2 },
    },
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -60 : 60,
    opacity: 0,
    transition: {
      x: { type: 'spring' as const, stiffness: 300, damping: 30 },
      opacity: { duration: 0.15 },
    },
  }),
};

function AppContent() {
  const [wasmReady, setWasmReady] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [tab, setTab] = useState<Tab>('send');
  const prevTabRef = useRef<Tab>('send');
  const splashStartRef = useRef(Date.now());
  
  // Track direction for slide animation (1 = right, -1 = left)
  const direction = tab === 'claim' ? 1 : -1;
  
  // Memoize tabs to prevent unnecessary re-renders
  const tabs = useMemo(() => TABS.map(t => ({ ...t })), []);

  // Dismiss splash after WASM ready + minimum duration
  const dismissSplash = useCallback(() => {
    const elapsed = Date.now() - splashStartRef.current;
    const remaining = Math.max(0, MIN_SPLASH_MS - elapsed);
    
    setTimeout(() => setShowSplash(false), remaining);
  }, []);

  // Initialize WASM
  useEffect(() => {
    init().then(() => {
      setWasmReady(true);
      dismissSplash();
      if (import.meta.env.DEV) {
        console.log('WASM prover ready');
      }
    }).catch((err) => {
      console.error('Failed to load WASM:', err);
      // Still dismiss splash on error — app can work partially without WASM
      dismissSplash();
    });
  }, [dismissSplash]);

  // Check URL for claim params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('id') || params.has('leaf')) {
      setTab('claim');
    }
  }, []);

  // Track previous tab for animation direction
  useEffect(() => {
    prevTabRef.current = tab;
  }, [tab]);

  return (
    <>
      {/* Branded splash screen during WASM init */}
      <SplashScreen visible={showSplash} />

      <div className="app">
        <Header wasmReady={wasmReady} />

        <TabBar 
          tabs={tabs}
          activeTab={tab}
          onChange={(id) => setTab(id as Tab)}
        />

        <main className="content">
          <AnimatePresence mode="wait" custom={direction} initial={false}>
            <motion.div
              key={tab}
              custom={direction}
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              style={{ width: '100%' }}
            >
              {tab === 'send' && <SendTab wasmReady={wasmReady} />}
              {tab === 'claim' && <ClaimTab wasmReady={wasmReady} />}
            </motion.div>
          </AnimatePresence>
        </main>

        <Footer />
      </div>
    </>
  );
}

function App() {
  return (
    <WalletProvider>
      <AppContent />
      <ToastContainer />
    </WalletProvider>
  );
}

export default App;
