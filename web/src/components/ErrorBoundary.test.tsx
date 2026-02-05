import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

// A component that always throws during render
const ThrowingComponent = ({ error }: { error?: Error }) => {
  throw error || new Error('Test render crash');
};

// A component that renders normally
const NormalComponent = () => <div data-testid="normal">Everything is fine</div>;

// Suppress console.error during error boundary tests (expected errors)
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('ErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <NormalComponent />
      </ErrorBoundary>
    );

    expect(screen.getByTestId('normal')).toBeDefined();
    expect(screen.getByText('Everything is fine')).toBeDefined();
  });

  it('catches render errors and shows error state', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );

    // Should show the error title
    expect(screen.getByText('Something went wrong')).toBeDefined();
    // Should show safety assurance
    expect(screen.getByText(/No funds were affected/)).toBeDefined();
    // Should show retry button
    expect(screen.getByText(/Try again/)).toBeDefined();
  });

  it('shows custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={<div data-testid="custom-fallback">Custom error UI</div>}>
        <ThrowingComponent />
      </ErrorBoundary>
    );

    expect(screen.getByTestId('custom-fallback')).toBeDefined();
    expect(screen.getByText('Custom error UI')).toBeDefined();
  });

  it('calls onError callback when error is caught', () => {
    const onError = vi.fn();
    const testError = new Error('Custom test error');

    render(
      <ErrorBoundary onError={onError}>
        <ThrowingComponent error={testError} />
      </ErrorBoundary>
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      testError,
      expect.objectContaining({
        componentStack: expect.any(String),
      })
    );
  });

  it('shows technical details when expanded', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );

    // Should have a details element
    const detailsEl = screen.getByText('Technical details');
    expect(detailsEl).toBeDefined();
  });

  it('includes scope in error details', () => {
    render(
      <ErrorBoundary scope="SendTab">
        <ThrowingComponent />
      </ErrorBoundary>
    );

    // The details section should contain the scope
    const detailsEl = screen.getByText('Technical details');
    fireEvent.click(detailsEl);

    // Check that scope is in the pre element text
    const preElements = document.querySelectorAll('pre');
    const hasScope = Array.from(preElements).some(el =>
      el.textContent?.includes('Scope: SendTab')
    );
    expect(hasScope).toBe(true);
  });

  it('applies compact class when compact prop is true', () => {
    render(
      <ErrorBoundary compact>
        <ThrowingComponent />
      </ErrorBoundary>
    );

    const boundary = document.querySelector('.error-boundary');
    expect(boundary?.classList.contains('compact')).toBe(true);
  });

  it('applies fullscreen class by default', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );

    const boundary = document.querySelector('.error-boundary');
    expect(boundary?.classList.contains('fullscreen')).toBe(true);
  });

  it('has proper ARIA role="alert"', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );

    const alert = screen.getByRole('alert');
    expect(alert).toBeDefined();
  });

  it('shows retry button with attempt counter on initial error', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );

    // Should show Try again with attempt count
    expect(screen.getByText(/Try again \(1\/3\)/)).toBeDefined();
  });

  it('increments retry count and eventually shows refresh page', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );

    // Click retry — ThrowingComponent will crash again, incrementing the counter
    fireEvent.click(screen.getByText(/Try again \(1\/3\)/));
    // After 1 retry that fails again, should show (2/3)
    expect(screen.getByText(/Try again \(2\/3\)/)).toBeDefined();

    fireEvent.click(screen.getByText(/Try again \(2\/3\)/));
    expect(screen.getByText(/Try again \(3\/3\)/)).toBeDefined();

    // One more retry exhausts the limit
    fireEvent.click(screen.getByText(/Try again \(3\/3\)/));

    // Now should show "Refresh page" and the exhausted title
    expect(screen.getByText('Refresh page')).toBeDefined();
    expect(screen.getByText('Something keeps going wrong')).toBeDefined();
  });
});
