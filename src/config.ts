import 'dotenv/config';

if (!process.env.PRIVATE_KEY) throw new Error('PRIVATE_KEY not set in .env');
if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN not set in .env');

export const config = {
  privateKey: process.env.PRIVATE_KEY,
  rpcUrl: process.env.RPC_URL ?? 'https://forno.celo.org',
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  agentId: 9358,

  // Balance alert thresholds
  lowCELO: Number(process.env.LOW_CELO ?? '0.5'),
  lowCUSD: Number(process.env.LOW_CUSD ?? '5'),
  largeTxCELO: Number(process.env.LARGE_TX_CELO ?? '5'),

  // Whale thresholds
  whaleCELO: Number(process.env.WHALE_CELO ?? '10000'),    // CELO
  whaleUSD:  Number(process.env.WHALE_USD  ?? '10000'),    // USD value

  watchIntervalMs: Number(process.env.WATCH_INTERVAL_MS ?? '30000'),

  // Email (optional — leave blank to disable)
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  emailFrom: process.env.EMAIL_FROM ?? 'Pulse <onboarding@resend.dev>',

  // Self Protocol (optional — needs a public HTTPS webhook URL)
  webhookUrl: process.env.WEBHOOK_URL ?? '',
  webhookPort: Number(process.env.WEBHOOK_PORT ?? '3001'),
};
