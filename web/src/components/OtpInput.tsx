import { useRef, useEffect, type FC } from 'react';
import './OtpInput.css';

interface Props {
  /** Current OTP value (digits only) */
  value: string;
  /** Called when value changes */
  onChange: (val: string) => void;
  /** Called when all digits are filled */
  onComplete: () => void;
  /** Number of digits (default 6) */
  length?: number;
  /** Auto-focus on mount */
  autoFocus?: boolean;
  /** Visual size variant */
  size?: 'md' | 'lg';
}

/**
 * Segmented OTP input — individual digit boxes with a single hidden native input.
 *
 * Venmo-style: clean, centered, satisfying feedback on each digit.
 * Handles paste, backspace, numeric keyboard, and auto-submit on completion.
 */
export const OtpInput: FC<Props> = ({
  value,
  onChange,
  onComplete,
  length = 6,
  autoFocus,
  size = 'md',
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // Trigger complete when all digits filled
  useEffect(() => {
    if (value.length === length) onComplete();
  }, [value, length, onComplete]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, length);
    onChange(raw);
  };

  // Clicking any segment focuses the hidden input
  const focusInput = () => inputRef.current?.focus();

  const digits = value.split('');

  return (
    <div
      className={`otp-container otp-${size}`}
      onClick={focusInput}
      role="group"
      aria-label="Verification code"
    >
      {/* Hidden native input that captures all keyboard/paste events */}
      <input
        ref={inputRef}
        className="otp-hidden-input"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={length}
        value={value}
        onChange={handleChange}
        aria-label={`${length}-digit verification code`}
      />
      {/* Visual segments */}
      <div className="otp-segments">
        {Array.from({ length }, (_, i) => (
          <div
            key={i}
            className={`otp-segment${digits[i] ? ' filled' : ''}${i === digits.length && digits.length < length ? ' active' : ''}`}
          >
            {digits[i] || ''}
          </div>
        ))}
      </div>
    </div>
  );
};

export default OtpInput;
