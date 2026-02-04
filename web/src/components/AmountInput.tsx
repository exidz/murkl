import { useRef, useEffect, useCallback, type FC, type ChangeEvent, type KeyboardEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import './AmountInput.css';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  currency?: string;
  currencySymbol?: string;
  placeholder?: string;
  maxDecimals?: number;
  autoFocus?: boolean;
  disabled?: boolean;
}

// Venmo-style auto-sizing: font shrinks as digits increase
const getFontSize = (value: string): number => {
  const len = value.length || 1;
  if (len <= 3) return 64;  // $0 to $999
  if (len <= 5) return 56;  // $1000 to $99999
  if (len <= 7) return 48;  // $100000 to $9999999
  if (len <= 9) return 40;  // Larger amounts
  return 32;                 // Very large amounts
};

export const AmountInput: FC<Props> = ({
  value,
  onChange,
  onSubmit,
  currency = 'SOL',
  currencySymbol = '◎',
  placeholder = '0',
  maxDecimals = 9,
  autoFocus = false,
  disabled = false,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);

  // Focus on mount if autoFocus
  useEffect(() => {
    if (autoFocus) {
      const timer = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [autoFocus]);

  // Handle input change with validation
  const handleChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    let newValue = e.target.value;
    
    // Remove non-numeric except decimal
    newValue = newValue.replace(/[^0-9.]/g, '');
    
    // Allow only one decimal point
    const parts = newValue.split('.');
    if (parts.length > 2) return;
    
    // Limit decimal places
    if (parts[1]?.length > maxDecimals) return;
    
    // Prevent leading zeros (except for decimals like "0.5")
    if (parts[0].length > 1 && parts[0].startsWith('0') && parts[0][1] !== '.') {
      newValue = parts[0].replace(/^0+/, '') + (parts[1] !== undefined ? '.' + parts[1] : '');
    }
    
    onChange(newValue);
  }, [onChange, maxDecimals]);

  // Handle enter key
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && onSubmit) {
      e.preventDefault();
      onSubmit();
    }
  }, [onSubmit]);

  // Calculate font size based on value length
  const fontSize = getFontSize(value);
  const displayValue = value || placeholder;
  const isEmpty = !value;

  return (
    <div className="amount-input-wrapper">
      {/* Main display area */}
      <div className="amount-display-container">
        {/* Currency symbol */}
        <motion.span 
          className="amount-currency"
          initial={false}
          animate={{ 
            fontSize: fontSize * 0.6,
            opacity: isEmpty ? 0.4 : 0.6,
          }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        >
          {currencySymbol}
        </motion.span>

        {/* Hidden input for actual editing */}
        <div className="amount-input-field">
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            className="amount-hidden-input"
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={disabled}
            style={{ fontSize }}
          />
          
          {/* Visual display with animation */}
          <motion.span
            className={`amount-display-value ${isEmpty ? 'placeholder' : ''}`}
            initial={false}
            animate={{ fontSize }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          >
            {displayValue}
          </motion.span>

          {/* Measuring element (hidden) */}
          <span 
            ref={measureRef} 
            className="amount-measure"
            style={{ fontSize }}
          >
            {displayValue}
          </span>
        </div>
      </div>

      {/* Currency label */}
      <AnimatePresence mode="wait">
        <motion.p 
          key={currency}
          className="amount-label"
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -5 }}
          transition={{ duration: 0.15 }}
        >
          {currency}
        </motion.p>
      </AnimatePresence>

      {/* Subtle pulse animation when typing */}
      {value && (
        <motion.div
          className="amount-pulse"
          initial={{ scale: 0.8, opacity: 0.5 }}
          animate={{ scale: 1.2, opacity: 0 }}
          transition={{ duration: 0.4 }}
          key={value.length}
        />
      )}
    </div>
  );
};

export default AmountInput;
