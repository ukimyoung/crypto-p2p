/** Networks each coin can be received on, matching the API's RECEIVING_NETWORKS, with the name shown for each. */
export const RECEIVING_NETWORKS: Record<string, { value: string; label: string }[]> = {
  BTC: [{ value: 'bitcoin', label: 'Bitcoin' }],
  ETH: [
    { value: 'ethereum', label: 'Ethereum' },
    { value: 'arbitrum', label: 'Arbitrum One' },
    { value: 'base', label: 'Base' },
  ],
  USDT: [
    { value: 'ethereum', label: 'Ethereum (ERC-20)' },
    { value: 'tron', label: 'Tron (TRC-20)' },
    { value: 'bsc', label: 'BNB Smart Chain (BEP-20)' },
  ],
};

/**
 * Networks custody sends each coin on (the API's `assets.network`). Withdrawals can only go out on
 * these, so the withdrawal address form offers no others.
 */
export const WITHDRAWAL_NETWORKS: Record<string, { value: string; label: string }[]> = {
  BTC: [{ value: 'bitcoin', label: 'Bitcoin' }],
  ETH: [{ value: 'ethereum', label: 'Ethereum' }],
  USDT: [{ value: 'ethereum', label: 'Ethereum (ERC-20)' }],
};

export function networkLabel(asset: string, network: string): string {
  return RECEIVING_NETWORKS[asset]?.find((n) => n.value === network)?.label ?? network;
}

/** What an address on the network looks like, as a placeholder for the address field. */
export function addressExample(network: string): string {
  if (network === 'bitcoin') return 'bc1q… / 1… / 3…';
  if (network === 'tron') return 'T…';
  return '0x…';
}
