import { ethers } from 'ethers';
import { config } from './config.js';
import { loadState, saveState, getAllUsers } from './storage.js';
import { detectAlerts } from './alerts.js';
import { writeReceipt } from './onchain.js';
import { scanWhales, formatWhaleAlert, whaleButtons } from './whale.js';
import { getCELOPrice } from './price.js';
import { sendAllDigests } from './email.js';
import { initVerifier } from './verify.js';
import { createServer, setVerifier } from './server.js';
import { setupBot } from './bot.js';

const CUSD = '0x765DE816845861e75A25fCA122bb6898B8B1282a';
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];

async function main() {
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const agentWallet = new ethers.Wallet(config.privateKey, provider);
  const state = loadState();
  const cusd = new ethers.Contract(CUSD, ERC20_ABI, provider);

  const agentAddress = await agentWallet.getAddress();
  const agentBalance = ethers.formatEther(await provider.getBalance(agentAddress));
  const currentBlock = await provider.getBlockNumber();

  // Initialise whale scan cursor to current block (don't scan history on start)
  if (state.lastWhaleBlock === 0) {
    state.lastWhaleBlock = currentBlock;
    saveState(state);
  }

  console.log('');
  console.log('  🔔 Pulse — Onchain Notification Agent for Celo');
  console.log('  ─────────────────────────────────────────────');
  console.log(`  Agent wallet : ${agentAddress}`);
  console.log(`  Agent balance: ${parseFloat(agentBalance).toFixed(4)} CELO`);
  console.log(`  Agent ID     : ${config.agentId} → https://8004scan.io/agents/${config.agentId}`);
  console.log(`  RPC          : ${config.rpcUrl}`);
  console.log(`  Watch interval: ${config.watchIntervalMs / 1000}s`);
  console.log(`  Whale threshold: ${config.whaleCELO.toLocaleString()} CELO / $${config.whaleUSD.toLocaleString()}`);
  console.log('');

  // Self Protocol identity verification
  const selfVerifier = initVerifier();

  const bot = setupBot(state, provider, agentWallet);

  // ── Main watcher loop ────────────────────────────────────────────────────
  async function runWatcher() {
    let currentBlock: number;
    try {
      currentBlock = await provider.getBlockNumber();
    } catch {
      console.error('[Watcher] RPC error, skipping cycle');
      return;
    }

    const users = getAllUsers(state);
    console.log(`[Watcher] Block ${currentBlock} | ${users.length} wallet(s)`);

    // ── Per-user balance checks ────────────────────────────────────────────
    for (const user of users) {
      try {
        const [celoRaw, cusdRaw] = await Promise.all([
          provider.getBalance(user.walletAddress),
          cusd.balanceOf(user.walletAddress),
        ]);
        const celoBal = ethers.formatEther(celoRaw);
        const cusdBal = ethers.formatEther(cusdRaw);

        const alerts = user.protocols.includes('balance')
          ? detectAlerts(user, celoBal, cusdBal)
          : [];

        for (const alert of alerts) {
          try {
            await bot.telegram.sendMessage(user.chatId, alert.message, {
              parse_mode: 'HTML',
              reply_markup: alert.buttons ? {
                inline_keyboard: alert.buttons.map(row =>
                  row.map(btn => ({ text: btn.text, url: btn.url }))
                ),
              } : undefined,
            });
            // Stamp cooldown so this alert type won't re-fire within its window
            if (!user.alertCooldowns) user.alertCooldowns = {};
            user.alertCooldowns[alert.type] = Date.now();
            const txHash = await writeReceipt(agentWallet, alert.type, user.walletAddress);
            if (txHash) {
              await bot.telegram.sendMessage(
                user.chatId,
                `📝 Onchain receipt: <a href="https://celoscan.io/tx/${txHash}">celoscan.io</a>`,
                { parse_mode: 'HTML' },
              );
            }
            user.alertCount++;
            console.log(`[Alert] ${alert.type} → chat:${user.chatId} | receipt:${txHash ?? 'none'}`);
          } catch (err) {
            console.error('[Alert] Delivery failed:', err);
          }
        }

        user.lastCELO = celoBal;
        user.lastCUSD = cusdBal;
        user.lastBlock = currentBlock;
        state.users[String(user.chatId)] = user;
      } catch (err) {
        console.error(`[Watcher] Error for wallet ${user.walletAddress}:`, err);
      }
    }

    // ── Whale scan (global — alerts all users with whale protocol) ─────────
    const whaleUsers = users.filter(u => u.protocols.includes('whale'));
    if (whaleUsers.length > 0 && currentBlock > state.lastWhaleBlock) {
      const fromBlock = state.lastWhaleBlock + 1;
      const toBlock   = currentBlock;
      console.log(`[Whale] Scanning blocks ${fromBlock}–${toBlock}`);

      try {
        const celoPrice = await getCELOPrice(provider);
        const moves = await scanWhales(provider, fromBlock, toBlock, config.whaleCELO, config.whaleUSD, celoPrice);
        console.log(`[Whale] Found ${moves.length} move(s)`);

        for (const move of moves) {
          const msg = formatWhaleAlert(move);
          for (const user of whaleUsers) {
            try {
              await bot.telegram.sendMessage(user.chatId, msg, {
                parse_mode: 'HTML',
                reply_markup: whaleButtons(move),
              });
              user.alertCount++;
            } catch {}
          }
          // One receipt per whale move (not per user) to avoid spam
          const txHash = await writeReceipt(agentWallet, 'whale_alert', move.from);
          if (txHash) console.log(`[Whale] Receipt: ${txHash}`);
        }
      } catch (err) {
        console.error('[Whale] Scan error:', err);
      }

      state.lastWhaleBlock = currentBlock;
    }

    // ── Price drop alert (global — alerts all users with price protocol) ────
    const priceUsers = users.filter(u => u.protocols.includes('price'));
    if (priceUsers.length > 0) {
      try {
        const celoPrice = await getCELOPrice(provider);

        // Initialise reference on first run
        if (!state.celoPriceRef) {
          state.celoPriceRef = celoPrice;
          console.log(`[Price] Reference set: $${celoPrice.toFixed(4)}`);
        } else {
          const dropPct = ((state.celoPriceRef - celoPrice) / state.celoPriceRef) * 100;
          console.log(`[Price] CELO $${celoPrice.toFixed(4)} | ref $${state.celoPriceRef.toFixed(4)} | Δ ${dropPct > 0 ? '-' : '+'}${Math.abs(dropPct).toFixed(2)}%`);

          if (dropPct >= config.priceDropPct) {
            const msg = [
              `📉 <b>CELO Price Drop Alert</b>`,
              ``,
              `CELO has dropped <b>${dropPct.toFixed(1)}%</b> from your alert reference.`,
              ``,
              `Current price: <b>$${celoPrice.toFixed(4)}</b>`,
              `Reference price: <b>$${state.celoPriceRef.toFixed(4)}</b>`,
              ``,
              `⚠️ If you hold CELO as collateral in any DeFi position, check your health factor now.`,
            ].join('\n');

            for (const user of priceUsers) {
              const cooldowns = user.alertCooldowns ?? {};
              const lastSent  = cooldowns['price_drop'] ?? 0;
              const cooldownMs = 2 * 60 * 60 * 1000; // 2 hours
              if (Date.now() - lastSent < cooldownMs) continue;

              try {
                await bot.telegram.sendMessage(user.chatId, msg, {
                  parse_mode: 'HTML',
                  reply_markup: {
                    inline_keyboard: [[
                      { text: '📊 Check wallet', url: `https://celoscan.io/address/${user.walletAddress}` },
                      { text: '🔄 Swap on Mento', url: 'https://app.mento.finance/swap' },
                    ]],
                  },
                });
                if (!user.alertCooldowns) user.alertCooldowns = {};
                user.alertCooldowns['price_drop'] = Date.now();
                user.alertCount++;
              } catch {}
            }

            // Reset reference so next drop is measured from the new price level
            state.celoPriceRef = celoPrice;
            console.log(`[Price] Alert fired — reference reset to $${celoPrice.toFixed(4)}`);
          }

          // Gradually walk reference up if price rises (track from recent highs)
          if (celoPrice > state.celoPriceRef) {
            state.celoPriceRef = celoPrice;
          }
        }
      } catch (err) {
        console.error('[Price] Detection error:', err);
      }
    }

    saveState(state);
  }

  if (config.webhookUrl) {
    // ── Production: webhook mode (no polling conflicts) ────────────────
    const telegramWebhook = `${config.webhookUrl}/telegram`;
    await bot.telegram.setWebhook(telegramWebhook, { drop_pending_updates: true });

    if (selfVerifier) setVerifier(selfVerifier);
    createServer(bot, state, config.webhookPort);

    console.log(`[Pulse] Webhook mode → ${telegramWebhook}`);
    console.log('[Pulse] Bot online.\n');
  } else {
    // ── Local dev: polling mode ────────────────────────────────────────
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    bot.launch();
    console.log('[Pulse] Polling mode — Bot online. Send /start in Telegram.\n');
  }

  // Run watcher immediately, then on interval
  await runWatcher();
  setInterval(runWatcher, config.watchIntervalMs);

  // Daily digest at 8:00 AM UTC
  let lastDigestDate = '';
  setInterval(() => {
    const now = new Date();
    const todayUTC = now.toISOString().split('T')[0];
    if (now.getUTCHours() === 8 && now.getUTCMinutes() === 0 && lastDigestDate !== todayUTC) {
      lastDigestDate = todayUTC;
      console.log('[Digest] Sending daily digests…');
      sendAllDigests(state, provider).catch(console.error);
    }
  }, 60000);

  process.once('SIGINT',  () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

main().catch(console.error);
