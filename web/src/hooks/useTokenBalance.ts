import { useQuery } from '@tanstack/react-query'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { PublicKey } from '@solana/web3.js'
import { getAssociatedTokenAddress } from '@solana/spl-token'

const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112')

export const balanceKeys = {
  all: ['balance'] as const,
  token: (wallet: string, symbol: string) => [...balanceKeys.all, wallet, symbol] as const,
}

export function useTokenBalance(symbol: string) {
  const { publicKey } = useWallet()
  const { connection } = useConnection()

  return useQuery({
    queryKey: balanceKeys.token(publicKey?.toBase58() || '', symbol),
    queryFn: async (): Promise<number | null> => {
      if (!publicKey) return null

      if (symbol === 'SOL') {
        const balance = await connection.getBalance(publicKey)
        return balance / 1e9
      }

      if (symbol === 'WSOL') {
        const ata = await getAssociatedTokenAddress(WSOL_MINT, publicKey)
        const ataInfo = await connection.getAccountInfo(ata)
        if (ataInfo) {
          const balance = ataInfo.data.readBigUInt64LE(64)
          return Number(balance) / 1e9
        }
        return 0
      }

      return null
    },
    enabled: !!publicKey,
    refetchInterval: 30_000, // Auto-refresh balance every 30s
  })
}
