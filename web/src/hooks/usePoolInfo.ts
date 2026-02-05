import { useQuery } from '@tanstack/react-query'
import { RELAYER_URL, POOL_ADDRESS } from '../lib/constants'

interface PoolInfo {
  merkleRoot: string;
  leafCount: number;
}

export const poolKeys = {
  all: ['pool'] as const,
  info: (pool: string) => [...poolKeys.all, pool] as const,
}

async function fetchPoolInfo(pool: string): Promise<PoolInfo> {
  const res = await fetch(`${RELAYER_URL}/pool-info?pool=${pool}`)
  if (!res.ok) throw new Error('Failed to fetch pool info')
  return res.json()
}

export function usePoolInfo(pool?: string) {
  const poolAddress = pool || POOL_ADDRESS.toBase58()
  return useQuery({
    queryKey: poolKeys.info(poolAddress),
    queryFn: () => fetchPoolInfo(poolAddress),
    staleTime: 30_000, // Pool info changes with deposits, refresh more often
  })
}
