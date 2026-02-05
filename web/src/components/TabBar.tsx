import { 
  useRef, 
  useEffect, 
  useState, 
  useCallback,
  type FC, 
  type ReactNode,
  type KeyboardEvent,
  type TouchEvent,
} from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import './TabBar.css';

interface Tab {
  id: string;
  label: string;
  icon?: ReactNode;
}

interface Props {
  tabs: Tab[];
  activeTab: string;
  onChange: (tabId: string) => void;
}

// Trigger haptic feedback on supported devices
const triggerHaptic = (pattern: number | number[] = 10) => {
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Silently fail if not supported
    }
  }
};

// Minimum swipe distance to trigger tab change
const SWIPE_THRESHOLD = 50;

/**
 * Venmo-style segmented tab bar with:
 * - Smooth sliding indicator
 * - Swipe gesture support for mobile
 * - Haptic feedback on tab change
 * - Full keyboard navigation (arrow keys + Home/End)
 * - Respects reduced motion preference
 */
export const TabBar: FC<Props> = ({ tabs, activeTab, onChange }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });
  const [isSwiping, setIsSwiping] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const reducedMotion = useReducedMotion();

  // Calculate indicator position based on active tab
  useEffect(() => {
    if (!containerRef.current) return;

    const activeIndex = tabs.findIndex(t => t.id === activeTab);
    if (activeIndex === -1) return;

    const tabElements = containerRef.current.querySelectorAll<HTMLButtonElement>('.tab-item');
    const activeElement = tabElements[activeIndex];
    
    if (activeElement) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const tabRect = activeElement.getBoundingClientRect();
      
      setIndicatorStyle({
        left: tabRect.left - containerRect.left,
        width: tabRect.width,
      });
    }
  }, [activeTab, tabs]);

  // Handle tab change with haptic feedback
  const handleTabChange = useCallback((tabId: string) => {
    if (tabId === activeTab) return;
    
    triggerHaptic([8, 5, 8]); // Subtle double-tap feel
    onChange(tabId);
  }, [activeTab, onChange]);

  // Navigate to adjacent tab
  const navigateTab = useCallback((direction: 'prev' | 'next' | 'first' | 'last') => {
    const currentIndex = tabs.findIndex(t => t.id === activeTab);
    let nextIndex: number;
    
    switch (direction) {
      case 'prev':
        nextIndex = currentIndex > 0 ? currentIndex - 1 : tabs.length - 1;
        break;
      case 'next':
        nextIndex = currentIndex < tabs.length - 1 ? currentIndex + 1 : 0;
        break;
      case 'first':
        nextIndex = 0;
        break;
      case 'last':
        nextIndex = tabs.length - 1;
        break;
    }
    
    const nextTab = tabs[nextIndex];
    if (nextTab) {
      handleTabChange(nextTab.id);
      // Focus the new tab button
      const tabElements = containerRef.current?.querySelectorAll<HTMLButtonElement>('.tab-item');
      tabElements?.[nextIndex]?.focus();
    }
  }, [tabs, activeTab, handleTabChange]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        navigateTab('prev');
        break;
      case 'ArrowRight':
        e.preventDefault();
        navigateTab('next');
        break;
      case 'Home':
        e.preventDefault();
        navigateTab('first');
        break;
      case 'End':
        e.preventDefault();
        navigateTab('last');
        break;
    }
  }, [navigateTab]);

  // Touch handlers for swipe gestures
  const handleTouchStart = useCallback((e: TouchEvent<HTMLDivElement>) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    setIsSwiping(false);
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent<HTMLDivElement>) => {
    if (!touchStartRef.current) return;
    
    const touch = e.touches[0];
    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;
    
    // If horizontal movement is greater than vertical, we're swiping
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
      setIsSwiping(true);
    }
  }, []);

  const handleTouchEnd = useCallback((e: TouchEvent<HTMLDivElement>) => {
    if (!touchStartRef.current) return;
    
    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;
    
    // Only process horizontal swipes
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > SWIPE_THRESHOLD) {
      if (deltaX > 0) {
        // Swiped right → go to previous tab
        navigateTab('prev');
      } else {
        // Swiped left → go to next tab
        navigateTab('next');
      }
    }
    
    touchStartRef.current = null;
    setIsSwiping(false);
  }, [navigateTab]);

  // Spring config for indicator animation
  const springConfig = reducedMotion 
    ? { duration: 0.1 }
    : { type: 'spring' as const, stiffness: 400, damping: 35 };

  return (
    <div 
      className={`tab-bar ${isSwiping ? 'swiping' : ''}`}
      ref={containerRef} 
      role="tablist"
      onKeyDown={handleKeyDown}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      aria-label="Main navigation"
    >
      {/* Sliding indicator */}
      <motion.div
        className="tab-indicator"
        initial={false}
        animate={{
          left: indicatorStyle.left,
          width: indicatorStyle.width,
        }}
        transition={springConfig}
      />

      {/* Tab buttons */}
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        
        return (
          <motion.button
            key={tab.id}
            className={`tab-item ${isActive ? 'active' : ''}`}
            onClick={() => handleTabChange(tab.id)}
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={isActive}
            aria-controls={`tabpanel-${tab.id}`}
            tabIndex={isActive ? 0 : -1}
            whileTap={!reducedMotion ? { scale: 0.97 } : undefined}
          >
            {tab.icon && (
              <motion.span 
                className="tab-icon"
                animate={isActive && !reducedMotion ? { 
                  scale: [1, 1.15, 1],
                } : {}}
                transition={{ duration: 0.3, delay: 0.05 }}
                key={isActive ? 'active' : 'inactive'}
              >
                {tab.icon}
              </motion.span>
            )}
            <span className="tab-label">{tab.label}</span>
            
            {/* Active glow effect on mobile */}
            {isActive && (
              <motion.div
                className="tab-active-glow"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.2 }}
                transition={{ duration: 0.2 }}
                aria-hidden="true"
              />
            )}
          </motion.button>
        );
      })}

      {/* Swipe hint - shows briefly on first visit */}
      <div className="swipe-hint" aria-hidden="true">
        ← swipe →
      </div>
    </div>
  );
};

export default TabBar;
