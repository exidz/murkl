import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRecentSends } from './useRecentSends';

describe('useRecentSends', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts empty when localStorage has nothing', () => {
    const { result } = renderHook(() => useRecentSends());
    expect(result.current.sends).toEqual([]);
  });

  it('adds a send to the list', () => {
    const { result } = renderHook(() => useRecentSends());

    act(() => {
      result.current.addSend({
        amount: 1.5,
        token: 'SOL',
        recipient: 'twitter:@alice',
        signature: 'sig123',
        shareLink: 'https://murkl.dev/claim?id=twitter:@alice&leaf=0',
      });
    });

    expect(result.current.sends).toHaveLength(1);
    expect(result.current.sends[0].amount).toBe(1.5);
    expect(result.current.sends[0].token).toBe('SOL');
    expect(result.current.sends[0].recipient).toBe('twitter:@alice');
    expect(result.current.sends[0].id).toBeDefined();
    expect(result.current.sends[0].timestamp).toBeDefined();
  });

  it('persists to localStorage', () => {
    const { result } = renderHook(() => useRecentSends());

    act(() => {
      result.current.addSend({
        amount: 2,
        token: 'WSOL',
        recipient: 'discord:bob',
        signature: 'sig456',
        shareLink: 'https://murkl.dev/claim?id=discord:bob&leaf=1',
      });
    });

    const stored = JSON.parse(localStorage.getItem('murkl:recent-sends')!);
    expect(stored).toHaveLength(1);
    expect(stored[0].amount).toBe(2);
  });

  it('prepends new sends (most recent first)', () => {
    const { result } = renderHook(() => useRecentSends());

    act(() => {
      result.current.addSend({
        amount: 1,
        token: 'SOL',
        recipient: 'twitter:@first',
        signature: 'sig1',
        shareLink: 'https://murkl.dev/claim?leaf=0',
      });
    });

    act(() => {
      result.current.addSend({
        amount: 2,
        token: 'SOL',
        recipient: 'twitter:@second',
        signature: 'sig2',
        shareLink: 'https://murkl.dev/claim?leaf=1',
      });
    });

    expect(result.current.sends).toHaveLength(2);
    expect(result.current.sends[0].recipient).toBe('twitter:@second');
    expect(result.current.sends[1].recipient).toBe('twitter:@first');
  });

  it('caps at 5 entries', () => {
    const { result } = renderHook(() => useRecentSends());

    for (let i = 0; i < 7; i++) {
      act(() => {
        result.current.addSend({
          amount: i + 1,
          token: 'SOL',
          recipient: `twitter:@user${i}`,
          signature: `sig${i}`,
          shareLink: `https://murkl.dev/claim?leaf=${i}`,
        });
      });
    }

    expect(result.current.sends).toHaveLength(5);
    // Most recent should be the last added
    expect(result.current.sends[0].amount).toBe(7);
  });

  it('clears all sends', () => {
    const { result } = renderHook(() => useRecentSends());

    act(() => {
      result.current.addSend({
        amount: 1,
        token: 'SOL',
        recipient: 'twitter:@alice',
        signature: 'sig1',
        shareLink: 'https://murkl.dev/claim?leaf=0',
      });
    });

    expect(result.current.sends).toHaveLength(1);

    act(() => {
      result.current.clearSends();
    });

    expect(result.current.sends).toEqual([]);
    expect(localStorage.getItem('murkl:recent-sends')).toBeNull();
  });

  it('reads initial state from localStorage', () => {
    const existing = [
      {
        id: 'existing-1',
        amount: 5,
        token: 'SOL',
        recipient: 'twitter:@stored',
        signature: 'sigStored',
        shareLink: 'https://murkl.dev/claim?leaf=5',
        timestamp: '2026-02-05T00:00:00.000Z',
      },
    ];
    localStorage.setItem('murkl:recent-sends', JSON.stringify(existing));

    const { result } = renderHook(() => useRecentSends());
    expect(result.current.sends).toHaveLength(1);
    expect(result.current.sends[0].recipient).toBe('twitter:@stored');
  });

  it('handles corrupted localStorage gracefully', () => {
    localStorage.setItem('murkl:recent-sends', 'not-valid-json');

    const { result } = renderHook(() => useRecentSends());
    expect(result.current.sends).toEqual([]);
  });

  it('handles non-array localStorage gracefully', () => {
    localStorage.setItem('murkl:recent-sends', JSON.stringify({ bad: true }));

    const { result } = renderHook(() => useRecentSends());
    expect(result.current.sends).toEqual([]);
  });
});
