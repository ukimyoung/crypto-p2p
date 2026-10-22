import { DomainError } from '../common/errors';

const BITCOIN = /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/;
const ETHEREUM = /^0x[0-9a-f]{40}$/;

/**
 * Checks the address format for the asset's network and returns its canonical form.
 * This catches typos and wrong-network pastes; checksum verification (base58check,
 * bech32, EIP-55) comes with the custody integration, which validates again before signing.
 */
export function normalizeAddress(network: string, raw: string): string {
  const trimmed = raw.trim();
  switch (network) {
    case 'bitcoin': {
      // Bech32 is case-insensitive but must not mix cases; base58 is case-sensitive.
      const lower = trimmed.toLowerCase();
      const singleCase = trimmed === lower || trimmed === trimmed.toUpperCase();
      const candidate = lower.startsWith('bc1') && singleCase ? lower : trimmed;
      if (BITCOIN.test(candidate)) return candidate;
      break;
    }
    case 'ethereum': {
      const lower = trimmed.toLowerCase();
      if (ETHEREUM.test(lower)) return lower;
      break;
    }
  }
  throw new DomainError('invalid_address', `Not a valid ${network} address`);
}
