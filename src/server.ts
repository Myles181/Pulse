import http from 'http';
import { Telegraf } from 'telegraf';
import { config } from './config.js';
import { getAllUsers, saveState } from './storage.js';
import type { AppState } from './types.js';

let verifier: any = null;

export function setVerifier(v: any) {
  verifier = v;
}

export function createServer(bot: Telegraf, state: AppState, port: number): http.Server {
  const server = http.createServer(async (req, res) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', async () => {
      // ── Health check ──────────────────────────────────────────────────
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', agent: config.agentId }));
        return;
      }

      // ── Telegram webhook ──────────────────────────────────────────────
      if (req.method === 'POST' && req.url === '/telegram') {
        try {
          await bot.handleUpdate(JSON.parse(body));
          res.writeHead(200);
          res.end('ok');
        } catch {
          res.writeHead(500);
          res.end();
        }
        return;
      }

      // ── Self Protocol verify ──────────────────────────────────────────
      if (req.method === 'POST' && req.url === '/api/verify') {
        if (!verifier) {
          res.writeHead(503);
          res.end(JSON.stringify({ status: 'verifier_not_ready' }));
          return;
        }
        try {
          const { attestationId, proof, pubSignals, userContextData } = JSON.parse(body);
          const result = await verifier.verify(attestationId, proof, pubSignals, userContextData);

          if (result.isValidDetails.isValid) {
            const chatId = parseInt(result.userData.userIdentifier, 16);
            const user = getAllUsers(state).find(u => u.chatId === chatId);
            if (user) {
              user.selfVerified = true;
              state.users[String(chatId)] = user;
              saveState(state);
              console.log(`[Self] ✅ Verified user ${chatId}`);
              // Notify user via bot
              bot.telegram.sendMessage(
                chatId,
                '✅ <b>Identity Verified!</b>\n\nYour Self Protocol verification is complete. Your profile now shows ✅ Verified.',
                { parse_mode: 'HTML' },
              ).catch(() => {});
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
          } else {
            res.writeHead(400);
            res.end(JSON.stringify({ status: 'verification_failed' }));
          }
        } catch (err) {
          console.error('[Server] /api/verify error:', err);
          res.writeHead(500);
          res.end();
        }
        return;
      }

      res.writeHead(404);
      res.end();
    });
  });

  server.listen(port, () => {
    console.log(`[Server] Listening on :${port}`);
  });

  return server;
}
