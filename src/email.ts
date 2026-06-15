import EthCrypto from 'eth-crypto';
import nodemailer from 'nodemailer';
import { ethers } from 'ethers';
import dns from 'dns';
import { config } from './config.js';
import { getAllUsers, saveState } from './storage.js';
import type { AppState } from './types.js';

// Force Node.js to use IPv4 to fix ENETUNREACH errors on Render/cloud hosts
// trying to route SMTP over unroutable IPv6 interfaces
dns.setDefaultResultOrder('ipv4first');

// Derive agent public key once from private key
const rawKey = config.privateKey.startsWith('0x') ? config.privateKey.slice(2) : config.privateKey;
export const AGENT_PUBLIC_KEY = EthCrypto.publicKeyByPrivateKey(rawKey);

// ── Encryption / Decryption ───────────────────────────────────────────────────
export async function encryptEmail(email: string): Promise<string> {
  const encrypted = await EthCrypto.encryptWithPublicKey(AGENT_PUBLIC_KEY, email);
  return JSON.stringify(encrypted);
}

export async function decryptEmail(encryptedJson: string): Promise<string> {
  const encrypted = JSON.parse(encryptedJson);
  return EthCrypto.decryptWithPrivateKey(rawKey, encrypted);
}

// ── Email sending via SMTP (app password) ─────────────────────────────────────
let transporter: nodemailer.Transporter | null = null;

if (config.smtpUser && config.smtpPass) {
  transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465, // true for SSL (465), false for STARTTLS (587)
    auth: {
      user: config.smtpUser,
      pass: config.smtpPass,
    },
    // Explicitly force IPv4 network family for Render
    family: 4,
    connectionTimeout: 10000,
  } as any);
  console.log(`[Email] SMTP ready → ${config.smtpUser} via ${config.smtpHost}:${config.smtpPort}`);
} else {
  console.log('[Email] SMTP_USER / SMTP_PASS not set — email disabled');
}

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!transporter) {
    console.warn('[Email] No SMTP transporter — skipping send');
    return false;
  }
  const from = config.emailFrom || `Pulse <${config.smtpUser}>`;
  try {
    await transporter.sendMail({ from, to, subject, html });
    console.log(`[Email] Sent to ${to}`);
    return true;
  } catch (err) {
    console.error('[Email] Send failed:', err);
    return false;
  }
}

// ── Welcome email ─────────────────────────────────────────────────────────────
export async function sendWelcomeEmail(to: string, walletAddress: string): Promise<boolean> {
  const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0a0a0a; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  .wrap { max-width: 560px; margin: 0 auto; padding: 48px 24px; }
  .logo { font-size: 32px; font-weight: 800; letter-spacing: -1px; margin-bottom: 8px; }
  .tag { display: inline-block; background: #35D07F; color: #000; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 20px; margin-bottom: 32px; }
  h2 { font-size: 22px; font-weight: 700; margin-bottom: 12px; }
  p { color: #aaa; line-height: 1.6; margin-bottom: 24px; }
  .card { background: #141414; border: 1px solid #222; border-radius: 12px; padding: 20px 24px; margin-bottom: 16px; }
  .card-label { font-size: 11px; color: #555; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
  .card-value { font-size: 14px; color: #fff; font-family: monospace; word-break: break-all; }
  .list { color: #aaa; padding-left: 20px; margin-bottom: 24px; line-height: 2; }
  .footer { margin-top: 48px; padding-top: 24px; border-top: 1px solid #1a1a1a; text-align: center; color: #444; font-size: 12px; }
  .footer a { color: #35D07F; text-decoration: none; }
</style>
</head>
<body>
<div class="wrap">
  <div class="logo">🔔 Pulse</div>
  <div class="tag">ERC-8004 Agent #${config.agentId}</div>

  <h2>You're in. Your wallet is now being watched.</h2>
  <p>Pulse will monitor your Celo wallet around the clock and alert you via Telegram and this inbox whenever something important happens.</p>

  <div class="card">
    <div class="card-label">Monitored Wallet</div>
    <div class="card-value">${walletAddress}</div>
  </div>

  <div class="card">
    <div class="card-label">Active Alerts</div>
    <div class="card-value">
      💰 Balance Alerts &nbsp;·&nbsp; 🐋 Whale Tracker
    </div>
  </div>

  <p>You'll receive a daily digest here every morning at 8:00 AM UTC with your wallet summary and any notable activity from the previous 24 hours.</p>

  <ul class="list">
    <li>Low CELO / cUSD balance warnings</li>
    <li>Large incoming &amp; outgoing transactions</li>
    <li>Whale moves on the Celo network</li>
    <li>DeFi position health (coming soon)</li>
  </ul>

  <div class="footer">
    <p>Powered by <a href="https://8004scan.io/agents/${config.agentId}">Pulse on 8004scan</a></p>
    <p style="margin-top:8px;">Your email is encrypted and never stored in plaintext.</p>
  </div>
</div>
</body>
</html>`;

  return sendEmail(to, '🔔 Pulse — Your wallet is now being watched', html);
}

// ── Daily digest ──────────────────────────────────────────────────────────────
function buildDigestHtml(
  walletAddress: string,
  celo: string,
  cusd: string,
  alertCount: number,
): string {
  const celoNum = parseFloat(celo);
  const cusdNum = parseFloat(cusd);
  const celoStatus = celoNum < config.lowCELO ? '⚠️' : '✅';
  const cusdStatus = cusdNum < config.lowCUSD ? '⚠️' : '✅';

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0a0a0a; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  .wrap { max-width: 560px; margin: 0 auto; padding: 48px 24px; }
  .logo { font-size: 28px; font-weight: 800; margin-bottom: 4px; }
  .date { color: #555; font-size: 13px; margin-bottom: 32px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px; }
  .card { background: #141414; border: 1px solid #222; border-radius: 12px; padding: 20px; }
  .card-label { font-size: 11px; color: #555; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
  .card-value { font-size: 28px; font-weight: 700; color: #35D07F; }
  .card-sub { font-size: 12px; color: #444; margin-top: 4px; }
  .wallet { background: #141414; border: 1px solid #222; border-radius: 12px; padding: 16px 20px; margin-bottom: 24px; }
  .wallet-label { font-size: 11px; color: #555; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
  .wallet-addr { font-family: monospace; font-size: 13px; color: #aaa; word-break: break-all; }
  .footer { margin-top: 40px; padding-top: 24px; border-top: 1px solid #1a1a1a; text-align: center; color: #444; font-size: 12px; }
  .footer a { color: #35D07F; text-decoration: none; }
</style>
</head>
<body>
<div class="wrap">
  <div class="logo">🔔 Pulse</div>
  <div class="date">Daily Digest · ${new Date().toUTCString()}</div>

  <div class="wallet">
    <div class="wallet-label">Monitored Wallet</div>
    <div class="wallet-addr">${walletAddress}</div>
  </div>

  <div class="grid">
    <div class="card">
      <div class="card-label">${celoStatus} CELO Balance</div>
      <div class="card-value">${celoNum.toFixed(4)}</div>
      <div class="card-sub">CELO</div>
    </div>
    <div class="card">
      <div class="card-label">${cusdStatus} cUSD Balance</div>
      <div class="card-value">${cusdNum.toFixed(2)}</div>
      <div class="card-sub">cUSD</div>
    </div>
  </div>

  <div class="card" style="margin-bottom:24px">
    <div class="card-label">Alerts in last 24h</div>
    <div class="card-value" style="font-size:36px">${alertCount}</div>
    <div class="card-sub">${alertCount === 0 ? 'All clear — no issues detected' : 'Check Telegram for details'}</div>
  </div>

  <div class="footer">
    <p><a href="https://8004scan.io/agents/${config.agentId}">Pulse · ERC-8004 Agent #${config.agentId}</a></p>
    <p style="margin-top:8px;">Your email is encrypted with the agent's public key and never stored in plaintext.</p>
  </div>
</div>
</body>
</html>`;
}

const CUSD = '0x765DE816845861e75A25fCA122bb6898B8B1282a';
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];

export async function sendAllDigests(
  state: AppState,
  provider: ethers.JsonRpcProvider,
): Promise<void> {
  const cusd = new ethers.Contract(CUSD, ERC20_ABI, provider);
  const users = getAllUsers(state);
  const withEmail = users.filter(u => u.encryptedEmail);

  console.log(`[Digest] Sending to ${withEmail.length} user(s)`);

  for (const user of withEmail) {
    let email: string | null = null;
    try {
      // Decrypt in-memory only — never persisted
      email = await decryptEmail(user.encryptedEmail!);

      const [celoRaw, cusdRaw] = await Promise.all([
        provider.getBalance(user.walletAddress),
        cusd.balanceOf(user.walletAddress),
      ]);

      const html = buildDigestHtml(
        user.walletAddress,
        ethers.formatEther(celoRaw),
        ethers.formatEther(cusdRaw),
        user.alertCount,
      );

      await sendEmail(email, '🔔 Pulse Daily Digest', html);

      // Reset daily alert counter
      user.alertCount = 0;
      state.users[String(user.chatId)] = user;
    } catch (err) {
      console.error(`[Digest] Failed for chat ${user.chatId}:`, err);
    } finally {
      // Wipe plaintext email from memory
      email = null;
    }
  }

  saveState(state);
}
