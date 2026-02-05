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
import { ErrorBoundary } from './components/ErrorBoundary';
import { NetworkStatus } from './components/NetworkStatus';
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
  const [unclaimedCount, setUnclaimedCount] = useState(0);
  const prevTabRef = useRef<Tab>('send');
  const splashStartRef = useRef(Date.now());
  
  // Track direction for slide animation (1 = right, -1 = left)
  const direction = tab === 'claim' ? 1 : -1;
  
  // Memoize tabs with badge counts — recalculate when unclaimed count changes
  const tabs = useMemo(() => TABS.map(t => ({
    ...t,
    badge: t.id === 'claim' ? unclaimedCount : undefined,
  })), [unclaimedCount]);

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

  // Sync tab from URL on load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const path = window.location.pathname;
    
    // ?tab=claim or /claim path or claim link params (?id, ?leaf)
    if (params.get('tab') === 'claim' || path === '/claim' || params.has('id') || params.has('leaf')) {
      setTab('claim');
    }
  }, []);

  // Track previous tab for animation direction + sync URL
  useEffect(() => {
    prevTabRef.current = tab;
    
    // Update URL without reload — preserve existing claim params (id, leaf, pool)
    const url = new URL(window.location.href);
    if (tab === 'claim') {
      url.searchParams.set('tab', 'claim');
    } else {
      url.searchParams.delete('tab');
      // Only clean claim params when leaving the claim tab
      url.searchParams.delete('id');
      url.searchParams.delete('leaf');
      url.searchParams.delete('pool');
    }
    // Clean path back to root
    url.pathname = '/';
    window.history.replaceState({}, '', url.toString());
  }, [tab]);

  return (
    <>
      {/* Branded splash screen during WASM init */}
      <SplashScreen visible={showSplash} />

      {/* Network connectivity banner — warns users before they try transacting offline */}
      <NetworkStatus />

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
              {tab === 'send' && (
                <ErrorBoundary scope="SendTab" compact>
                  <SendTab wasmReady={wasmReady} />
                </ErrorBoundary>
              )}
              {tab === 'claim' && (
                <ErrorBoundary scope="ClaimTab" compact>
                  <ClaimTab wasmReady={wasmReady} onUnclaimedCount={setUnclaimedCount} />
                </ErrorBoundary>
              )}
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
    <ErrorBoundary scope="App">
      <WalletProvider>
        <AppContent />
        <ToastContainer />
      </WalletProvider>
    </ErrorBoundary>
  );
}

export default App;
