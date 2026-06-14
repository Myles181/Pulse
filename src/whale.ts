import { ethers } from 'ethers';

// Known Celo ecosystem addresses
const KNOWN_WALLETS: Record<string, string> = {
  '0x246f4599eFD3fA67AC44335Ed5e749E518Ffd8bB': 'Celo Foundation',
  '0xD533Ca259b330c7A88f74E000a3FaEa2d63B7972': 'Curve Finance',
  '0x71E26d0E519D14591b9dE9a0fE9513A398101490': 'Mento Reserve',
  '0x87647780180B8f55980C7D3fFeFe08a9B29e9aE1': 'Ubeswap Router',
  '0x9a01bf917477dD9F5D715D188618fc8B7350cd22': 'Binance',
  '0xe7804c37c13166fF0b37F5aE0BB07A3aEbb6e245': 'Coinbase',
};

const CUSD  = '0x765DE816845861e75A25fCA122bb6898B8B1282a';
const CEUR  = '0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73';
const USDC  = '0xcebA9300f2b948710d2653dD7B07f33A8B32118C';

const TRANSFER_ABI = ['event Transfer(address indexed from, address indexed to, uint256 value)'];

export interface WhaleMove {
  hash: string;
  from: string;
  fromLabel: string | null;
  to: string;
  toLabel: string | null;
  symbol: string;
  amount: string;
  amountUSD: number;
}

function label(addr: string): string | null {
  return KNOWN_WALLETS[ethers.getAddress(addr)] ?? null;
}

function fmt(n: bigint, decimals = 18): string {
  return parseFloat(ethers.formatUnits(n, decimals)).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export async function scanWhales(
  provider: ethers.JsonRpcProvider,
  fromBlock: number,
  toBlock: number,
  cELOMin: number,     // minimum CELO to flag
  cUSDMin: number,     // minimum cUSD/USDC to flag
  celoUSDPrice = 0.36, // live price injected from Mento SortedOracles
): Promise<WhaleMove[]> {
  const moves: WhaleMove[] = [];

  // ── Native CELO large transfers (scan block txns) ──────────────────────────
  for (let b = fromBlock; b <= toBlock; b++) {
    let block: ethers.Block | null;
    try {
      block = await provider.getBlock(b, true);
    } catch {
      continue;
    }
    if (!block) continue;

    for (const tx of block.prefetchedTransactions) {
      const celo = parseFloat(ethers.formatEther(tx.value));
      if (celo >= cELOMin && tx.to) {
        moves.push({
          hash: tx.hash,
          from: tx.from,
          fromLabel: label(tx.from),
          to: tx.to,
          toLabel: label(tx.to),
          symbol: 'CELO',
          amount: fmt(tx.value),
          amountUSD: Math.round(celo * celoUSDPrice),
        });
      }
    }
  }

  // ── ERC-20 stablecoin large transfers ─────────────────────────────────────
  const tokens: Array<{ address: string; symbol: string; usdPer: number }> = [
    { address: CUSD,  symbol: 'cUSD',  usdPer: 1 },
    { address: CEUR,  symbol: 'cEUR',  usdPer: 1.08 },
    { address: USDC,  symbol: 'USDC',  usdPer: 1 },
  ];

  for (const token of tokens) {
    try {
      const contract = new ethers.Contract(token.address, TRANSFER_ABI, provider);
      const events = await contract.queryFilter(contract.filters.Transfer(), fromBlock, toBlock);
      for (const e of events) {
        if (!('args' in e)) continue;
        const amount = parseFloat(ethers.formatEther(e.args.value));
        if (amount >= cUSDMin) {
          moves.push({
            hash: e.transactionHash,
            from: e.args.from,
            fromLabel: label(e.args.from),
            to: e.args.to,
            toLabel: label(e.args.to),
            symbol: token.symbol,
            amount: fmt(e.args.value),
            amountUSD: Math.round(amount * token.usdPer),
          });
        }
      }
    } catch {}
  }

  return moves;
}

export function whaleButtons(w: WhaleMove) {
  return {
    inline_keyboard: [[
      { text: '🔍 View transaction', url: `https://celoscan.io/tx/${w.hash}` },
      { text: `🔄 Swap ${w.symbol}`, url: `https://app.mento.finance/swap?from=${w.symbol}` },
    ]],
  };
}

export function formatWhaleAlert(w: WhaleMove): string {
  const fromStr = w.fromLabel
    ? `${w.fromLabel} (<code>${w.from.slice(0, 10)}…</code>)`
    : `<code>${w.from.slice(0, 10)}…</code> (Unknown)`;
  const toStr = w.toLabel
    ? `${w.toLabel} (<code>${w.to.slice(0, 10)}…</code>)`
    : `<code>${w.to.slice(0, 10)}…</code> (Unknown)`;

  return [
    '🐋 <b>Whale Alert — Celo Network</b>',
    '',
    `<b>${w.amount} ${w.symbol}</b> moved (~$${w.amountUSD.toLocaleString()})`,
    '',
    `From: ${fromStr}`,
    `To:   ${toStr}`,
    '',
    `<a href="https://celoscan.io/tx/${w.hash}">View on Celoscan →</a>`,
  ].join('\n');
}

export const DEMO_WHALE: WhaleMove = {
  hash: '0xdemo0000000000000000000000000000000000000000000000000000000001',
  from: '0x9a01bf917477dD9F5D715D188618fc8B7350cd22',
  fromLabel: 'Binance',
  to: '0x0000000000000000000000000000000000000042',
  toLabel: null,
  symbol: 'CELO',
  amount: '500,000',
  amountUSD: 180000,
};
