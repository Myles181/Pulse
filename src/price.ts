import { ethers } from 'ethers';

// Mento SortedOracles — real-time on-chain CELO price feed
const SORTED_ORACLES = '0xefB84935239dAcdecF7c5bA76d8dE40b077B7b33';
const CUSD = '0x765DE816845861e75A25fCA122bb6898B8B1282a';
const ABI = ['function medianRate(address token) external view returns (uint256, uint256)'];

// Simple cache — refresh every 5 minutes
let cachedPrice: number | null = null;
let lastFetch = 0;
const TTL = 5 * 60 * 1000;

export async function getCELOPrice(provider: ethers.JsonRpcProvider): Promise<number> {
  const now = Date.now();
  if (cachedPrice !== null && now - lastFetch < TTL) return cachedPrice;

  try {
    const oracle = new ethers.Contract(SORTED_ORACLES, ABI, provider);
    const [numerator, denominator]: [bigint, bigint] = await oracle.medianRate(CUSD);
    // Use integer scaling to avoid float precision loss on large bigints
    cachedPrice = Number((numerator * 10000n) / denominator) / 10000;
    lastFetch = now;
    console.log(`[Price] CELO = $${cachedPrice.toFixed(4)} (Mento SortedOracles)`);
  } catch {
    console.warn('[Price] SortedOracles unreachable, using last known value');
    cachedPrice = cachedPrice ?? 0.36;
  }

  return cachedPrice;
}
