import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { AppState, User, Protocol } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.resolve(__dirname, '../data/users.json');

const DEFAULT_PROTOCOLS: Protocol[] = ['balance', 'whale'];

function ensureDir() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
}

export function loadState(): AppState {
  try {
    ensureDir();
    if (fs.existsSync(DATA_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) as Partial<AppState>;
      // Backfill any missing fields from older saves
      for (const user of Object.values(raw.users ?? {})) {
        if (!user.protocols) user.protocols = [...DEFAULT_PROTOCOLS];
        // encryptedEmail is optional — no backfill needed
      }
      return { users: raw.users ?? {}, lastWhaleBlock: raw.lastWhaleBlock ?? 0 };
    }
  } catch {}
  return { users: {}, lastWhaleBlock: 0 };
}

export function saveState(state: AppState): void {
  ensureDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

export function registerUser(state: AppState, chatId: number, wallet: string): User {
  const user: User = {
    chatId,
    walletAddress: wallet.toLowerCase(),
    lastCELO: '-1',
    lastCUSD: '-1',
    lastBlock: 0,
    alertCount: 0,
    registeredAt: Date.now(),
    protocols: [...DEFAULT_PROTOCOLS],
  };
  state.users[String(chatId)] = user;
  saveState(state);
  return user;
}

export function removeUser(state: AppState, chatId: number): boolean {
  if (!state.users[String(chatId)]) return false;
  delete state.users[String(chatId)];
  saveState(state);
  return true;
}

export function getUser(state: AppState, chatId: number): User | undefined {
  return state.users[String(chatId)];
}

export function getAllUsers(state: AppState): User[] {
  return Object.values(state.users);
}

export function toggleProtocol(state: AppState, chatId: number, protocol: Protocol): boolean {
  const user = state.users[String(chatId)];
  if (!user) return false;
  const idx = user.protocols.indexOf(protocol);
  if (idx >= 0) user.protocols.splice(idx, 1);
  else user.protocols.push(protocol);
  saveState(state);
  return user.protocols.includes(protocol);
}
