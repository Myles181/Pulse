import { config } from './config.js';
import type { User, Alert } from './types.js';

const MENTO_SWAP = 'https://app.mento.finance/swap';
const celoscan  = (addr: string) => `https://celoscan.io/address/${addr}`;

export function detectAlerts(user: User, celoBal: string, cusdBal: string): Alert[] {
  const alerts: Alert[] = [];
  const celo     = parseFloat(celoBal);
  const cusd     = parseFloat(cusdBal);
  const prevCelo = parseFloat(user.lastCELO);
  const prevCusd = parseFloat(user.lastCUSD);
  const isFirst  = user.lastCELO === '-1';

  // ── Low CELO (gas) ────────────────────────────────────────────────────────
  if (celo < config.lowCELO && (isFirst || prevCelo >= config.lowCELO)) {
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
  if (cusd < config.lowCUSD && (isFirst || prevCusd >= config.lowCUSD)) {
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
    if (sent > config.largeTxCELO) {
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
    if (received > config.largeTxCELO) {
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
