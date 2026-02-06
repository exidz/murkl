import { useMutation, useQueryClient } from '@tanstack/react-query'
import { RELAYER_URL } from '../lib/constants'
import { depositKeys } from './useDeposits'

interface RegisterDepositParams {
  identifier: string;
  amount: number;
  token: string;
  leafIndex: number;
  pool: string;
  commitment: Uint8Array | string;
  txSignature: string;
}

function toHex(data: Uint8Array | string): string {
  if (typeof data === 'string') return data;
  return Array.from(data).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function useRegisterDeposit() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: RegisterDepositParams) => {
      const res = await fetch(`${RELAYER_URL}/deposits/register`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...params,
          commitment: toHex(params.commitment),
        }),
      })
      if (!res.ok) throw new Error('Failed to register deposit')
      return res.json()
    },
    onSuccess: (_data, variables) => {
      // Invalidate deposits for this identity so they refresh
      queryClient.invalidateQueries({ queryKey: depositKeys.byIdentity(variables.identifier) })
    },
  })
}
