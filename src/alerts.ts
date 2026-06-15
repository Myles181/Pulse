import { config } from './config.js';
import type { User, Alert } from './types.js';

const MENTO_SWAP = 'https://app.mento.finance/swap';
const celoscan  = (addr: string) => `https://celoscan.io/address/${addr}`;

// How long (ms) before the same alert type can fire again per user
const COOLDOWNS: Record<string, number> = {
  low_celo:        4 * 60 * 60 * 1000, // 4 hours
  low_cusd:        4 * 60 * 60 * 1000, // 4 hours
  large_outgoing:  1 * 60 * 60 * 1000, // 1 hour
  large_incoming:  1 * 60 * 60 * 1000, // 1 hour
  price_drop:      2 * 60 * 60 * 1000, // 2 hours
};

function isCoolingDown(user: User, alertType: string): boolean {
  const last = user.alertCooldowns?.[alertType];
  if (!last) return false;
  const window = COOLDOWNS[alertType] ?? 60 * 60 * 1000; // default 1h
  return Date.now() - last < window;
}

export function detectAlerts(user: User, celoBal: string, cusdBal: string): Alert[] {
  const alerts: Alert[] = [];
  const celo     = parseFloat(celoBal);
  const cusd     = parseFloat(cusdBal);
  const prevCelo = parseFloat(user.lastCELO);
  const prevCusd = parseFloat(user.lastCUSD);
  const isFirst  = user.lastCELO === '-1';

  // ── Low CELO (gas) ────────────────────────────────────────────────────────
  if (celo < config.lowCELO && (isFirst || prevCelo >= config.lowCELO) && !isCoolingDown(user, 'low_celo')) {
    alerts.push({
      type: 'low_celo',
      message: [
        '⚠️ <b>Low CELO Balance — Gas Running Low</b>',
        '',
        `Wallet: <code>${user.walletAddress}</code>`,
        `Balance: <b>${celo.toFixed(4)} CELO</b>`,
        `Threshold: ${config.lowCELO} CELO`,
        '',
        'You may not have enough CELO to pay gas fees. Swap some cUSD → CELO now.',
      ].join('\n'),
      buttons: [
        [
          { text: '⛽ Swap cUSD → CELO on Mento', url: `${MENTO_SWAP}?from=cUSD&to=CELO` },
        ],
        [
          { text: '👛 View wallet', url: celoscan(user.walletAddress) },
        ],
      ],
    });
  }

  // ── Low cUSD ──────────────────────────────────────────────────────────────
  if (cusd < config.lowCUSD && (isFirst || prevCusd >= config.lowCUSD) && !isCoolingDown(user, 'low_cusd')) {
    alerts.push({
      type: 'low_cusd',
      message: [
        '⚠️ <b>Low cUSD Balance</b>',
        '',
        `Wallet: <code>${user.walletAddress}</code>`,
        `Balance: <b>${cusd.toFixed(2)} cUSD</b>`,
        `Threshold: ${config.lowCUSD} cUSD`,
      ].join('\n'),
      buttons: [
        [
          { text: '🔄 Swap CELO → cUSD on Mento', url: `${MENTO_SWAP}?from=CELO&to=cUSD` },
        ],
        [
          { text: '👛 View wallet', url: celoscan(user.walletAddress) },
        ],
      ],
    });
  }

  if (!isFirst) {
    // ── Large outgoing ───────────────────────────────────────────────────────
    const sent = prevCelo - celo;
    if (sent > config.largeTxCELO && !isCoolingDown(user, 'large_outgoing')) {
      alerts.push({
        type: 'large_outgoing',
        message: [
          '🚨 <b>Large Outgoing Transaction Detected</b>',
          '',
          `Wallet: <code>${user.walletAddress}</code>`,
          `Sent: <b>~${sent.toFixed(3)} CELO</b>`,
          `New balance: ${celo.toFixed(4)} CELO`,
          '',
          celo < config.lowCELO ? '⛽ Gas is now low — consider topping up.' : '',
        ].join('\n').trim(),
        buttons: [
          [
            { text: '🔍 View wallet on Celoscan', url: celoscan(user.walletAddress) },
            { text: '⛽ Get gas', url: `${MENTO_SWAP}?from=cUSD&to=CELO` },
          ],
        ],
      });
    }

    // ── Large incoming ───────────────────────────────────────────────────────
    const received = celo - prevCelo;
    if (received > config.largeTxCELO && !isCoolingDown(user, 'large_incoming')) {
      alerts.push({
        type: 'large_incoming',
        message: [
          '💰 <b>Large Incoming Transaction</b>',
          '',
          `Wallet: <code>${user.walletAddress}</code>`,
          `Received: <b>~${received.toFixed(3)} CELO</b>`,
          `New balance: ${celo.toFixed(4)} CELO`,
        ].join('\n'),
        buttons: [
          [
            { text: '🔍 View wallet on Celoscan', url: celoscan(user.walletAddress) },
            { text: '🔄 Swap to cUSD', url: `${MENTO_SWAP}?from=CELO&to=cUSD` },
          ],
        ],
      });
    }
  }

  return alerts;
}
