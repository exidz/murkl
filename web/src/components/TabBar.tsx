import { useRef, useEffect, useState, type FC, type ReactNode } from 'react';
import { motion } from 'framer-motion';
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

/**
 * Venmo-style segmented tab bar with smooth sliding indicator.
 * Uses layout animation for the active indicator.
 */
export const TabBar: FC<Props> = ({ tabs, activeTab, onChange }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });

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

  return (
    <div className="tab-bar" ref={containerRef} role="tablist">
      {/* Sliding indicator */}
      <motion.div
        className="tab-indicator"
        initial={false}
        animate={{
          left: indicatorStyle.left,
          width: indicatorStyle.width,
        }}
        transition={{
          type: 'spring',
          stiffness: 400,
          damping: 35,
        }}
      />

      {/* Tab buttons */}
      {tabs.map(tab => {
        const isActive = tab.id === activeTab;
        
        return (
          <button
            key={tab.id}
            className={`tab-item ${isActive ? 'active' : ''}`}
            onClick={() => onChange(tab.id)}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
          >
            {tab.icon && <span className="tab-icon">{tab.icon}</span>}
            <span className="tab-label">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default TabBar;
