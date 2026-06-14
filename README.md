# 🔔 Pulse — Onchain Notification Agent for Celo

> The privacy-first notification agent for Celo. Monitors your wallet 24/7 and alerts you to balance drops, whale moves, and DeFi opportunities — without ever storing your contact info in plaintext.

**ERC-8004 Agent #9358** · Built for the [Celo Onchain Agents Hackathon 2026](https://celoplatform.notion.site/Onchain-Agents-Hackathon)

---

## Features

| Feature | Description |
|---|---|
| 💰 **Balance Alerts** | Low CELO / cUSD warnings + large tx detection |
| 🐋 **Whale Tracker** | Scans every Celo block for large CELO, cUSD, cEUR, USDC moves |
| ⚙️ **Protocol Selection** | Inline Telegram keyboard — toggle alerts per protocol |
| 📧 **Email Digest** | Daily 8AM UTC digest, email encrypted with agent public key |
| 🪪 **Self Protocol** | ZK passport verification — prove you're human without revealing identity |
| ⛓️ **Onchain Receipts** | Every alert writes an immutable receipt to the ERC-8004 Reputation Registry |

## Built on Celo

- **ERC-8004** — Agent identity + reputation registry
- **Mento SortedOracles** — Live onchain CELO/USD price (no third-party API)
- **Self Protocol** — ZK passport verification via `IdentityVerificationHub`
- **eth-crypto** — Agent public key encryption for email storage
- **Forno RPC** — Native Celo block scanning

## Quick Start

```bash
git clone https://github.com/Myles181/Pulse.git
cd Pulse
npm install
cp .env.example .env
# Fill in your .env values
npm start
```

### Bot Commands

| Command | Description |
|---|---|
| `/register 0x...` | Start monitoring a wallet |
| `/protocols` | Toggle alert types (inline keyboard) |
| `/status` | Live CELO + cUSD balances |
| `/check` | Force an immediate wallet scan |
| `/email you@...` | Register encrypted email for daily digest |
| `/verify` | Self Protocol ZK passport verification |
| `/test` | Fire example alerts + write onchain receipt |
| `/unregister` | Stop monitoring |

## Environment Variables

```env
PRIVATE_KEY=           # Agent wallet private key
TELEGRAM_BOT_TOKEN=    # From @BotFather
RPC_URL=https://forno.celo.org

LOW_CELO=0.5           # Alert threshold (CELO)
LOW_CUSD=5             # Alert threshold (cUSD)
LARGE_TX_CELO=5        # Large tx threshold (CELO)
WATCH_INTERVAL_MS=30000

WHALE_CELO=50          # Whale alert threshold (CELO)
WHALE_USD=500          # Whale alert threshold (USD)

RESEND_API_KEY=        # https://resend.com (optional)
EMAIL_FROM=Pulse <onboarding@resend.dev>

WEBHOOK_URL=           # Public HTTPS URL for Self Protocol callbacks
WEBHOOK_PORT=3001
```

## Architecture

```
src/
├── index.ts      — Entry point, watcher loop, daily digest cron
├── bot.ts        — Telegram bot + all commands
├── alerts.ts     — Balance + transaction trigger detection
├── whale.ts      — Block scanner for large transfers
├── onchain.ts    — ERC-8004 receipt writing
├── email.ts      — eth-crypto encryption + Resend digest
├── verify.ts     — Self Protocol webhook + ZK verification
├── price.ts      — Mento SortedOracles live price feed
├── storage.ts    — Persistent user state (JSON)
├── config.ts     — Environment config
└── types.ts      — TypeScript interfaces
```

## Privacy Model

Email addresses are encrypted with the agent's public key using `eth-crypto` before storage — the same privacy architecture [Herald](https://useherald.xyz) uses on Solana. Plaintext is only held in memory during delivery, then wiped immediately.

## Onchain Identity

- **Agent ID:** [#9358 on 8004scan](https://8004scan.io/agents/9358)
- **Agent JSON:** [agent.json](https://raw.githubusercontent.com/Myles181/Pulse/main/agent.json)
- **Network:** Celo Mainnet (Chain ID: 42220)

## Running in Production

Deploy to Railway:
1. Connect this repo at [railway.app](https://railway.app)
2. Set all environment variables
3. Start command: `npm start`
4. Set `WEBHOOK_URL` to your Railway deployment URL for Self Protocol

## License

MIT
