import { Telegraf, Markup } from 'telegraf';
import { ethers } from 'ethers';
import { config } from './config.js';
import { registerUser, removeUser, getUser, toggleProtocol, saveState } from './storage.js';
import { writeReceipt } from './onchain.js';
import { formatWhaleAlert, DEMO_WHALE } from './whale.js';
import { encryptEmail, sendWelcomeEmail } from './email.js';
import { generateVerifyLink } from './verify.js';
import type { AppState, User, Protocol } from './types.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CUSD = '0x765DE816845861e75A25fCA122bb6898B8B1282a';
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];

const PROTOCOL_META: Record<Protocol, { emoji: string; label: string }> = {
  balance:    { emoji: '💰', label: 'Balance Alerts' },
  whale:      { emoji: '🐋', label: 'Whale Tracker' },
  mento:      { emoji: '🏦', label: 'Mento Positions' },
  governance: { emoji: '🗳️', label: 'Governance' },
};

function protocolsKeyboard(user: User) {
  const row = (p: Protocol) => {
    const { emoji, label } = PROTOCOL_META[p];
    const active = user.protocols.includes(p);
    return Markup.button.callback(`${active ? '✅' : '⬜'} ${emoji} ${label}`, `toggle_${p}`);
  };
  return Markup.inlineKeyboard([
    [row('balance'), row('whale')],
    [row('mento'),   row('governance')],
  ]);
}

export function setupBot(
  state: AppState,
  provider: ethers.JsonRpcProvider,
  agentWallet: ethers.Wallet,
) {
  const bot = new Telegraf(config.telegramToken);
  const cusd = new ethers.Contract(CUSD, ERC20_ABI, provider);

  // ── /start ────────────────────────────────────────────────────────────────
  bot.command('start', (ctx) => {
    ctx.reply(
      [
        '🔔 <b>Welcome to Pulse</b>',
        'The onchain notification agent for Celo.',
        '',
        'Pulse monitors your wallet 24/7:',
        '• 💰 Low CELO / cUSD balance',
        '• 🚨 Large incoming / outgoing transactions',
        '• 🐋 Whale moves on Celo network',
        '',
        '<b>Get started:</b>',
        '/register <code>0xYourWalletAddress</code>',
        '',
        '/protocols — Choose what to monitor',
        '/email     — Get daily digest emails',
        '/verify    — Verify identity via Self Protocol',
        '/status    — Current balances',
        '/check     — Immediate wallet scan',
        '/test      — See example alerts',
      ].join('\n'),
      { parse_mode: 'HTML' },
    );
  });

  bot.command('help', (ctx) => {
    ctx.reply(
      [
        '🔔 <b>Pulse Commands</b>',
        '',
        '/register <code>0x…</code> — Start monitoring a wallet',
        '/protocols — Toggle alert types',
        '/email <code>you@…</code> — Daily digest emails',
        '/status    — Live balance snapshot',
        '/check     — Run an immediate scan',
        '/test      — Fire example alerts',
        '/unregister — Stop monitoring',
      ].join('\n'),
      { parse_mode: 'HTML' },
    );
  });

  // ── /register ────────────────────────────────────────────────────────────
  bot.command('register', async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/);
    const wallet = parts[1];

    if (!wallet || !ethers.isAddress(wallet)) {
      return ctx.reply('❌ Invalid address.\n\nUsage: /register <code>0x…</code>', { parse_mode: 'HTML' });
    }

    registerUser(state, ctx.chat.id, wallet);
    await ctx.reply(
      [
        '✅ <b>Wallet registered!</b>',
        '',
        `Address: <code>${wallet}</code>`,
        '',
        `Active alerts: Balance + Whale Tracker`,
        `Use /protocols to customise.`,
      ].join('\n'),
      { parse_mode: 'HTML' },
    );
  });

  // ── /protocols ────────────────────────────────────────────────────────────
  bot.command('protocols', async (ctx) => {
    const user = getUser(state, ctx.chat.id);
    if (!user) {
      return ctx.reply('Register first: /register <code>0x…</code>', { parse_mode: 'HTML' });
    }
    await ctx.reply(
      '⚙️ <b>Protocol Selection</b>\n\nTap to toggle. Each change is recorded onchain.',
      { parse_mode: 'HTML', ...protocolsKeyboard(user) },
    );
  });

  // Callback for each protocol toggle
  const PROTOCOLS: Protocol[] = ['balance', 'whale', 'mento', 'governance'];
  for (const p of PROTOCOLS) {
    bot.action(`toggle_${p}`, async (ctx) => {
      const user = getUser(state, ctx.chat!.id);
      if (!user) return ctx.answerCbQuery('Register first!');

      const nowActive = toggleProtocol(state, ctx.chat!.id, p);
      const { emoji, label } = PROTOCOL_META[p];

      // Write onchain receipt for the preference update (generates Track 2 txns)
      writeReceipt(agentWallet, `toggle_${p}`, user.walletAddress).catch(() => {});

      await ctx.editMessageReplyMarkup(protocolsKeyboard(user).reply_markup);
      await ctx.answerCbQuery(`${nowActive ? '✅' : '⬜'} ${emoji} ${label} ${nowActive ? 'enabled' : 'disabled'}`);
    });
  }

  // ── /status ───────────────────────────────────────────────────────────────
  bot.command('status', async (ctx) => {
    const user = getUser(state, ctx.chat.id);
    if (!user) {
      return ctx.reply('No wallet registered. Use /register <code>0x…</code>', { parse_mode: 'HTML' });
    }

    await ctx.reply('🔍 Fetching balances…');
    try {
      const [celoRaw, cusdRaw] = await Promise.all([
        provider.getBalance(user.walletAddress),
        cusd.balanceOf(user.walletAddress),
      ]);
      const celo = parseFloat(ethers.formatEther(celoRaw));
      const cusdBal = parseFloat(ethers.formatEther(cusdRaw));

      await ctx.reply(
        [
          '📊 <b>Wallet Status</b>',
          '',
          `Address: <code>${user.walletAddress}</code>`,
          '',
          `${celo < config.lowCELO ? '⚠️' : '✅'} CELO: <b>${celo.toFixed(4)}</b>`,
          `${cusdBal < config.lowCUSD ? '⚠️' : '✅'} cUSD: <b>${cusdBal.toFixed(2)}</b>`,
          '',
          `🔔 Alerts sent: ${user.alertCount}`,
          `⚙️ Active: ${user.protocols.map(p => PROTOCOL_META[p].label).join(', ')}`,
          `🪪 Identity: ${user.selfVerified ? '✅ Verified (Self Protocol)' : '⬜ Unverified — /verify'}`,
          `📅 Since: ${new Date(user.registeredAt).toLocaleDateString()}`,
        ].join('\n'),
        { parse_mode: 'HTML' },
      );
    } catch {
      await ctx.reply('❌ Could not fetch balances. Try again.');
    }
  });

  // ── /check ────────────────────────────────────────────────────────────────
  bot.command('check', async (ctx) => {
    const user = getUser(state, ctx.chat.id);
    if (!user) {
      return ctx.reply('Register first: /register <code>0x…</code>', { parse_mode: 'HTML' });
    }

    await ctx.reply('⚡ Running immediate check…');
    const { detectAlerts } = await import('./alerts.js');

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

      if (alerts.length === 0) {
        await ctx.reply('✅ All clear — no alerts triggered.');
      }

      for (const alert of alerts) {
        await ctx.reply(alert.message, {
          parse_mode: 'HTML',
          reply_markup: alert.buttons ? {
            inline_keyboard: alert.buttons.map(row =>
              row.map(btn => ({ text: btn.text, url: btn.url }))
            ),
          } : undefined,
        });
        const txHash = await writeReceipt(agentWallet, alert.type, user.walletAddress);
        if (txHash) {
          await ctx.reply(
            `📝 Onchain receipt: <a href="https://celoscan.io/tx/${txHash}">celoscan.io</a>`,
            { parse_mode: 'HTML' },
          );
        }
        user.alertCount++;
      }

      user.lastCELO = celoBal;
      user.lastCUSD = cusdBal;
      state.users[String(user.chatId)] = user;
      const { saveState } = await import('./storage.js');
      saveState(state);
    } catch {
      await ctx.reply('❌ Check failed. Try again.');
    }
  });

  // ── /unregister ───────────────────────────────────────────────────────────
  bot.command('unregister', async (ctx) => {
    const removed = removeUser(state, ctx.chat.id);
    await ctx.reply(removed ? '✅ Wallet unregistered.' : 'No wallet registered.');
  });

  // ── /test ─────────────────────────────────────────────────────────────────
  bot.command('test', async (ctx) => {
    // Show balance alert example
    await ctx.reply(
      [
        '🧪 <b>Example: Balance Alert</b>',
        '',
        '⚠️ <b>Low CELO Balance Alert</b>',
        '',
        'Wallet: <code>0xYourWallet…</code>',
        'Balance: <b>0.3 CELO</b>',
        `Threshold: ${config.lowCELO} CELO`,
        '',
        'Your CELO is running low. Top up to keep transacting!',
      ].join('\n'),
      { parse_mode: 'HTML' },
    );

    // Show whale alert example
    await ctx.reply(formatWhaleAlert(DEMO_WHALE), { parse_mode: 'HTML' });

    await ctx.reply('📝 Writing onchain receipt for this test…');
    const txHash = await writeReceipt(agentWallet, 'test_alert', '0x0000000000000000');

    if (txHash) {
      await ctx.reply(
        [
          '✅ <b>Onchain Receipt Written</b>',
          '',
          `Tx: <code>${txHash}</code>`,
          `<a href="https://celoscan.io/tx/${txHash}">View on Celoscan →</a>`,
        ].join('\n'),
        { parse_mode: 'HTML' },
      );
    } else {
      await ctx.reply('📝 Alerts delivered! (Fund agent wallet for onchain receipts)');
    }
  });

  // ── /email ────────────────────────────────────────────────────────────────
  bot.command('email', async (ctx) => {
    const user = getUser(state, ctx.chat.id);
    if (!user) {
      return ctx.reply('Register first: /register <code>0x…</code>', { parse_mode: 'HTML' });
    }

    const parts = ctx.message.text.trim().split(/\s+/);
    const emailInput = parts[1];

    if (!emailInput) {
      const status = user.encryptedEmail ? '✅ Email registered' : '❌ No email registered';
      return ctx.reply(
        [
          `📧 <b>Email Notifications</b>`,
          '',
          status,
          '',
          'Add your email for daily digests:',
          '/email <code>you@example.com</code>',
          '',
          'Your email is encrypted with the agent\'s public key and never stored in plaintext.',
        ].join('\n'),
        { parse_mode: 'HTML' },
      );
    }

    if (!EMAIL_REGEX.test(emailInput)) {
      return ctx.reply('❌ Invalid email address.');
    }

    await ctx.reply('🔐 Encrypting email with agent public key…');

    try {
      const encrypted = await encryptEmail(emailInput);
      user.encryptedEmail = encrypted;
      state.users[String(user.chatId)] = user;
      saveState(state);

      // Write onchain receipt
      writeReceipt(agentWallet, 'email_registered', user.walletAddress).catch(() => {});

      await ctx.reply(
        [
          '✅ <b>Email registered!</b>',
          '',
          `Address: <code>${emailInput}</code>`,
          '',
          '🔐 Encrypted with agent public key — never stored in plaintext.',
          '📬 You\'ll receive a daily digest at 8:00 AM UTC.',
          '',
          'Sending welcome email now…',
        ].join('\n'),
        { parse_mode: 'HTML' },
      );

      // Send welcome email (fire-and-forget)
      sendWelcomeEmail(emailInput, user.walletAddress).then((ok) => {
        if (ok) {
          ctx.reply('📧 Welcome email sent! Check your inbox.');
        } else {
          ctx.reply('⚠️ Could not send welcome email. Check RESEND_API_KEY in config.');
        }
      });
    } catch (err) {
      await ctx.reply('❌ Failed to register email. Try again.');
      console.error('[Email cmd]', err);
    }
  });

  // ── /verify (Self Protocol) ───────────────────────────────────────────────
  bot.command('verify', async (ctx) => {
    const user = getUser(state, ctx.chat.id);
    if (!user) {
      return ctx.reply('Register first: /register <code>0x…</code>', { parse_mode: 'HTML' });
    }

    if (user.selfVerified) {
      return ctx.reply(
        '✅ <b>Already verified!</b>\n\nYour identity has been confirmed via Self Protocol.',
        { parse_mode: 'HTML' },
      );
    }

    const link = generateVerifyLink(ctx.chat.id);

    if (!link) {
      return ctx.reply(
        [
          '⚙️ Self Protocol verification is not configured.',
          '',
          'To enable it, set <code>WEBHOOK_URL</code> in your .env to a public HTTPS URL.',
          'Use <code>ngrok http 3001</code> to expose locally.',
        ].join('\n'),
        { parse_mode: 'HTML' },
      );
    }

    await ctx.reply(
      [
        '🪪 <b>Verify with Self Protocol</b>',
        '',
        'Prove you\'re a real human using your passport — without revealing any personal data.',
        '',
        '1. Install the Self app (iOS / Android)',
        '2. Tap the link below',
        '3. Scan your passport',
        '',
        `<a href="${link}">Open Self Protocol →</a>`,
        '',
        'Once verified, your profile gets a ✅ badge and access to premium alerts.',
      ].join('\n'),
      { parse_mode: 'HTML', link_preview_options: { is_disabled: true } },
    );
  });

  // ── /removeemail ──────────────────────────────────────────────────────────
  bot.command('removeemail', async (ctx) => {
    const user = getUser(state, ctx.chat.id);
    if (!user || !user.encryptedEmail) {
      return ctx.reply('No email registered.');
    }
    delete user.encryptedEmail;
    state.users[String(user.chatId)] = user;
    saveState(state);
    await ctx.reply('✅ Email removed. You will no longer receive digest emails.');
  });

  bot.catch((err: any) => {
    if (err?.response?.error_code === 409) {
      console.error('[Bot] 409 — another instance is running. Kill it first: pkill -f "tsx src/index"');
      process.exit(1);
    }
    console.error('[Bot]', err);
  });

  return bot;
}
