import { memo, type FC } from 'react';
import { motion } from 'framer-motion';
import './AmountPresets.css';

interface Preset {
  value: number;
  label: string;
}

interface Props {
  onSelect: (amount: string) => void;
  currentValue: string;
  currency?: string;
  presets?: Preset[];
}

// Default presets for SOL
const DEFAULT_PRESETS: Preset[] = [
  { value: 0.1, label: '0.1' },
  { value: 0.5, label: '0.5' },
  { value: 1, label: '1' },
  { value: 5, label: '5' },
];

/**
 * Venmo-style quick amount preset buttons.
 * Allows users to quickly select common amounts with a single tap.
 * 
 * Features:
 * - Animated selection state
 * - Responsive grid layout
 * - Touch-friendly 44px+ tap targets
 * - Visual feedback on press
 */
export const AmountPresets: FC<Props> = memo(({
  onSelect,
  currentValue,
  currency = 'SOL',
  presets = DEFAULT_PRESETS,
}) => {
  const currentNum = parseFloat(currentValue) || 0;

  return (
    <div className="amount-presets" role="group" aria-label="Quick amount selection">
      {presets.map((preset, index) => {
        const isSelected = currentNum === preset.value;
        
        return (
          <motion.button
            key={preset.value}
            type="button"
            className={`preset-btn ${isSelected ? 'selected' : ''}`}
            onClick={() => onSelect(String(preset.value))}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            whileTap={{ scale: 0.95 }}
            aria-pressed={isSelected}
          >
            <span className="preset-value">{preset.label}</span>
            <span className="preset-currency">{currency}</span>
            
            {/* Selection indicator */}
            {isSelected && (
              <motion.div
                className="preset-selected-bg"
                layoutId="preset-selected"
                initial={false}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}
          </motion.button>
        );
      })}
    </div>
  );
});

AmountPresets.displayName = 'AmountPresets';

export default AmountPresets;
