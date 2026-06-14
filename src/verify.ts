import http from 'http';
import { randomUUID } from 'crypto';
import { SelfBackendVerifier, DefaultConfigStore, AllIds } from '@selfxyz/core';
import { SelfAppBuilder, getUniversalLink } from '@selfxyz/common';
import { config } from './config.js';
import { getAllUsers, saveState } from './storage.js';
import type { AppState } from './types.js';

const SCOPE = 'pulse-agent';

let verifier: SelfBackendVerifier | null = null;

export function initVerifier(): any {
  if (!config.webhookUrl) {
    console.log('[Self] WEBHOOK_URL not set — Self Protocol verification disabled');
    return null;
  }
  verifier = new SelfBackendVerifier(
    SCOPE,
    config.webhookUrl,
    false,
    AllIds,
    new DefaultConfigStore({ minimumAge: 18, ofac: true }),
    'hex',
  );
  console.log(`[Self] Verifier ready → ${config.webhookUrl}`);
  return verifier;
}

export function generateVerifyLink(chatId: number): string | null {
  if (!config.webhookUrl) return null;

  // Encode chatId as 32-byte hex — recovered from userData.userIdentifier on callback
  const userIdHex = chatId.toString(16).padStart(64, '0');

  const app = new SelfAppBuilder({
    appName: 'Pulse',
    scope: SCOPE,
    endpoint: config.webhookUrl,
    endpointType: 'https',
    sessionId: randomUUID(),
    userId: userIdHex,
    userIdType: 'hex',
    devMode: false,
    chainID: 42220,   // Celo mainnet
    disclosures: { minimumAge: 18, ofac: true },
    header: 'Verify your identity to unlock Pulse',
    logoBase64: '',
    deeplinkCallback: '',
    userDefinedData: '',
    version: 1,
  }).build();

  return getUniversalLink(app);
}

export function startWebhookServer(state: AppState, port = 3001): void {
  if (!verifier) return;

  const server = http.createServer(async (req, res) => {
    // Health check
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', agent: config.agentId }));
      return;
    }

    if (req.method !== 'POST' || req.url !== '/api/verify') {
      res.writeHead(404);
      res.end();
      return;
    }

    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', async () => {
      try {
        const { attestationId, proof, pubSignals, userContextData } = JSON.parse(body);
        const result = await verifier!.verify(attestationId, proof, pubSignals, userContextData);

        if (result.isValidDetails.isValid) {
          // Decode chatId from the hex userIdentifier Self Protocol echoes back
          const chatId = parseInt(result.userData.userIdentifier, 16);
          const user = getAllUsers(state).find(u => u.chatId === chatId);

          if (user) {
            user.selfVerified = true;
            state.users[String(chatId)] = user;
            saveState(state);
            console.log(`[Self] ✅ Verified user ${chatId} (${user.walletAddress})`);
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'verification_failed' }));
        }
      } catch (err) {
        console.error('[Self] Webhook error:', err);
        res.writeHead(500);
        res.end(JSON.stringify({ status: 'error' }));
      }
    });
  });

  server.listen(port, () => {
    console.log(`[Self] Webhook server → :${port}/api/verify`);
  });
}
