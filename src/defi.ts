import { ethers } from 'ethers';
import { getCELOPrice } from './price.js';
import type { AppState, User, Alert } from './types.js';

// ── Contract addresses (Celo Mainnet) ────────────────────────────────────────
const SORTED_ORACLES  = '0xefB84935239dAcdecF7c5bA76d8dE40b077B7b33';
const BIPOOL_MANAGER  = '0x22d9db95e6ae61c104a7b6f6c78d7993b94ec901';
const CUSD            = '0x765DE816845861e75A25fCA122bb6898B8B1282a';

// ── ABIs ─────────────────────────────────────────────────────────────────────
const ORACLES_ABI = [
  'function medianRate(address token) external view returns (uint256, uint256)',
];

const BIPOOL_ABI = [
  'function getExchanges() external view returns (bytes32[] memory)',
  'function getPoolExchange(bytes32 exchangeId) external view returns (address asset0, address asset1, tuple() config, uint256 bucket0, uint256 bucket1, uint256 lastBucketUpdate, bool isActive)',
];

// ── Constants ─────────────────────────────────────────────────────────────────
const SIX_HOURS  = 6 * 60 * 60 * 1000;
const TEN_MINS   = 10 * 60 * 1000;
const DEPEG_LOW  = 0.98;
const DEPEG_HIGH = 1.02;
const RESERVE_THRESHOLD_PCT = 15;
const ENTRY_DROP_PCT        = 20;

// Cached exchange ID so we don't re-scan on every tick
let cachedExchangeId: string | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────
function isCoolingDown(user: User, alertType: string): boolean {
  const last = user.alertCooldowns?.[alertType];
  if (!last) return false;
  return Date.now() - last < SIX_HOURS;
}

async function getCUSDExchangeId(provider: ethers.JsonRpcProvider): Promise<string | null> {
  if (cachedExchangeId) return cachedExchangeId;
  try {
    const bipool = new ethers.Contract(BIPOOL_MANAGER, BIPOOL_ABI, provider);
    const ids: string[] = await bipool.getExchanges();
    for (const id of ids) {
      const ex = await bipool.getPoolExchange(id);
      if (
        ex.asset0.toLowerCase() === CUSD.toLowerCase() ||
        ex.asset1.toLowerCase() === CUSD.toLowerCase()
      ) {
        cachedExchangeId = id;
        console.log(`[DeFi] cUSD exchange ID: ${id}`);
        return id;
      }
    }
  } catch (err) {
    console.error('[DeFi] Could not resolve exchange ID:', err);
  }
  return null;
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function checkDeFiAlerts(
  user: User,
  state: AppState,
  provider: ethers.JsonRpcProvider,
): Promise<Alert[]> {
  const alerts: Alert[] = [];

  // ── Check 1: cUSD Depeg ──────────────────────────────────────────────────
  if (!isCoolingDown(user, 'defi_depeg')) {
    try {
      const oracle = new ethers.Contract(SORTED_ORACLES, ORACLES_ABI, provider);
      const [num, den]: [bigint, bigint] = await oracle.medianRate(CUSD);
      const cusdPrice = Number((num * 10000n) / den) / 10000;

      if (cusdPrice > DEPEG_HIGH || cusdPrice < DEPEG_LOW) {
        const dir = cusdPrice > DEPEG_HIGH ? '📈 above' : '📉 below';
        alerts.push({
          type: 'defi_depeg',
          message: [
            '⚠️ <b>cUSD Depeg Alert</b>',
            '',
            `cUSD is trading ${dir} its $1.00 peg.`,
            `Current: <b>$${cusdPrice.toFixed(4)}</b>`,
            `Safe range: $${DEPEG_LOW} – $${DEPEG_HIGH}`,
            '',
            'Consider adjusting any cUSD positions or collateral.',
          ].join('\n'),
          buttons: [[
            { text: '🔄 Trade on Mento', url: 'https://app.mento.finance/swap?from=cUSD&to=USDC' },
          ]],
        });
        console.log(`[DeFi] cUSD depeg detected: $${cusdPrice.toFixed(4)}`);
      }
    } catch (err) {
      console.error('[DeFi] Depeg check error:', err);
    }
  }

  // ── Check 2: Mento Reserve Movement ──────────────────────────────────────
  if (!isCoolingDown(user, 'defi_reserve')) {
    try {
      const exchangeId = await getCUSDExchangeId(provider);
      if (exchangeId) {
        const bipool = new ethers.Contract(BIPOOL_MANAGER, BIPOOL_ABI, provider);
        const ex = await bipool.getPoolExchange(exchangeId);
        const b0 = BigInt(ex.bucket0);
        const b1 = BigInt(ex.bucket1);
        const now = Date.now();

        // Only compare if we have a fresh-enough snapshot (within 10 min)
        if (
          state.reserveSnapshot &&
          now - state.reserveSnapshot.ts < TEN_MINS &&
          state.reserveSnapshot.exchangeId === exchangeId
        ) {
          const prev0 = BigInt(state.reserveSnapshot.bucket0);
          const prev1 = BigInt(state.reserveSnapshot.bucket1);

          const pct = (curr: bigint, prev: bigint) =>
            prev > 0n
              ? Number(((curr > prev ? curr - prev : prev - curr) * 10000n) / prev) / 100
              : 0;

          const change0 = pct(b0, prev0);
          const change1 = pct(b1, prev1);

          if (change0 > RESERVE_THRESHOLD_PCT || change1 > RESERVE_THRESHOLD_PCT) {
            alerts.push({
              type: 'defi_reserve',
              message: [
                '🏦 <b>Mento Reserve Movement Detected</b>',
                '',
                'A Mento liquidity pool bucket has shifted significantly in the last 10 minutes.',
                `Asset 0 change: <b>${change0.toFixed(1)}%</b>`,
                `Asset 1 change: <b>${change1.toFixed(1)}%</b>`,
                '',
                'This may indicate large arbitrage activity or protocol rebalancing.',
              ].join('\n'),
              buttons: [[
                { text: '🔍 View Mento', url: 'https://app.mento.finance' },
                { text: '🔄 Trade now', url: 'https://app.mento.finance/swap?from=cUSD&to=CELO' },
              ]],
            });
            console.log(`[DeFi] Reserve movement: b0=${change0.toFixed(1)}% b1=${change1.toFixed(1)}%`);
          }
        }

        // Always update the snapshot
        state.reserveSnapshot = {
          exchangeId,
          bucket0: b0.toString(),
          bucket1: b1.toString(),
          ts: now,
        };
      }
    } catch (err) {
      console.error('[DeFi] Reserve check error:', err);
    }
  }

  // ── Check 3: CELO Entry Price ─────────────────────────────────────────────
  if (!isCoolingDown(user, 'defi_price_entry') && user.celoPriceAtRegistration) {
    try {
      const currentPrice = await getCELOPrice(provider);
      const entryPrice   = user.celoPriceAtRegistration;
      const dropPct      = ((entryPrice - currentPrice) / entryPrice) * 100;

      if (dropPct >= ENTRY_DROP_PCT) {
        alerts.push({
          type: 'defi_price_entry',
          message: [
            '📉 <b>CELO Down Since You Registered</b>',
            '',
            `CELO has dropped <b>${dropPct.toFixed(1)}%</b> since you started monitoring.`,
            '',
            `Your entry price: <b>$${entryPrice.toFixed(4)}</b>`,
            `Current price:   <b>$${currentPrice.toFixed(4)}</b>`,
            '',
            '⚠️ If you hold CELO as collateral in any DeFi position, check your health factor.',
          ].join('\n'),
          buttons: [[
            { text: '🔄 Manage on Mento', url: 'https://app.mento.finance' },
            { text: '📊 View wallet', url: `https://celoscan.io/address/${user.walletAddress}` },
          ]],
        });
        console.log(`[DeFi] Entry drop: -${dropPct.toFixed(1)}% (entry $${entryPrice.toFixed(4)} → now $${currentPrice.toFixed(4)})`);
      }
    } catch (err) {
      console.error('[DeFi] Entry price check error:', err);
    }
  }

  return alerts;
}
