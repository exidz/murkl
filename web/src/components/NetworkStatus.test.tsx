import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { NetworkStatus } from './NetworkStatus';

// Mock navigator.onLine
let onlineStatus = true;
const onlineListeners: Set<() => void> = new Set();
const offlineListeners: Set<() => void> = new Set();

beforeEach(() => {
  onlineStatus = true;

  Object.defineProperty(navigator, 'onLine', {
    get: () => onlineStatus,
    configurable: true,
  });

  // Mock window event listeners
  vi.spyOn(window, 'addEventListener').mockImplementation((event, handler) => {
    if (event === 'online') onlineListeners.add(handler as () => void);
    if (event === 'offline') offlineListeners.add(handler as () => void);
  });

  vi.spyOn(window, 'removeEventListener').mockImplementation((event, handler) => {
    if (event === 'online') onlineListeners.delete(handler as () => void);
    if (event === 'offline') offlineListeners.delete(handler as () => void);
  });
});

afterEach(() => {
  onlineListeners.clear();
  offlineListeners.clear();
  vi.restoreAllMocks();
});

const goOffline = () => {
  onlineStatus = false;
  offlineListeners.forEach(fn => fn());
};

const goOnline = () => {
  onlineStatus = true;
  onlineListeners.forEach(fn => fn());
};

describe('NetworkStatus', () => {
  it('renders nothing when online', () => {
    render(<NetworkStatus />);

    // Should not show any status banner
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows offline banner when network disconnects', () => {
    render(<NetworkStatus />);

    act(() => {
      goOffline();
    });

    expect(screen.getByRole('status')).toBeDefined();
    expect(screen.getByText(/offline/i)).toBeDefined();
  });

  it('shows "Back online" when reconnecting', async () => {
    render(<NetworkStatus />);

    // Go offline first
    act(() => {
      goOffline();
    });

    expect(screen.getByText(/offline/i)).toBeDefined();

    // Come back online
    act(() => {
      goOnline();
    });

    expect(screen.getByText(/Back online/i)).toBeDefined();
  });

  it('has aria-live="assertive" for screen readers', () => {
    render(<NetworkStatus />);

    act(() => {
      goOffline();
    });

    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('assertive');
  });

  it('applies offline class when disconnected', () => {
    render(<NetworkStatus />);

    act(() => {
      goOffline();
    });

    const status = screen.getByRole('status');
    expect(status.classList.contains('offline')).toBe(true);
  });

  it('applies reconnected class when coming back online', () => {
    render(<NetworkStatus />);

    act(() => {
      goOffline();
    });

    act(() => {
      goOnline();
    });

    const status = screen.getByRole('status');
    expect(status.classList.contains('reconnected')).toBe(true);
  });

  it('does not show "Back online" if was never offline', () => {
    render(<NetworkStatus />);

    // Simulate online event without ever going offline
    act(() => {
      goOnline();
    });

    // Should not show anything
    expect(screen.queryByText(/Back online/i)).toBeNull();
  });

  it('mentions transactions in offline message', () => {
    render(<NetworkStatus />);

    act(() => {
      goOffline();
    });

    // Should mention that transactions can't be sent
    expect(screen.getByText(/transactions/i)).toBeDefined();
  });

  it('cleans up event listeners on unmount', () => {
    const { unmount } = render(<NetworkStatus />);
    const removeCallsBefore = (window.removeEventListener as ReturnType<typeof vi.fn>).mock.calls.length;

    unmount();

    const removeCallsAfter = (window.removeEventListener as ReturnType<typeof vi.fn>).mock.calls.length;
    // Should have called removeEventListener for both online and offline
    expect(removeCallsAfter - removeCallsBefore).toBeGreaterThanOrEqual(2);
  });
});
