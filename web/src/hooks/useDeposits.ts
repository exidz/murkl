import { useQuery } from '@tanstack/react-query'
import { RELAYER_URL } from '../lib/constants'

interface Deposit {
  id: string;
  amount: number;
  token: string;
  leafIndex: number;
  timestamp: string;
  claimed: boolean;
}

export const depositKeys = {
  all: ['deposits'] as const,
  byIdentity: (identity: string) => [...depositKeys.all, identity] as const,
}

async function fetchDeposits(identity: string): Promise<Deposit[]> {
  const res = await fetch(`${RELAYER_URL}/deposits?identity=${encodeURIComponent(identity)}`, {
    credentials: 'include',
  })
  if (!res.ok) throw new Error('Failed to fetch deposits')
  const data = await res.json()
  return data.deposits || []
}

export function useDeposits(identity: string | null) {
  return useQuery({
    queryKey: depositKeys.byIdentity(identity!),
    queryFn: () => fetchDeposits(identity!),
    enabled: !!identity,
  })
}
