export type Protocol = 'balance' | 'whale' | 'price' | 'mento' | 'governance';

export interface User {
  chatId: number;
  walletAddress: string;
  lastCELO: string;   // '-1' = not yet fetched
  lastCUSD: string;
  lastBlock: number;
  alertCount: number;
  registeredAt: number;
  protocols: Protocol[];
  encryptedEmail?: string;        // AES-encrypted, never plaintext
  selfVerified?: boolean;         // Self Protocol passport verification
  alertCooldowns?: Record<string, number>; // alertType → last sent timestamp (ms)
  celoPriceAtRegistration?: number;        // CELO/USD at time of /register
}

export interface AppState {
  users: Record<string, User>;
  lastWhaleBlock: number;
  celoPriceRef?: number;      // reference price for drop % calculation
  reserveSnapshot?: {         // cached BiPoolManager bucket sizes for reserve movement check
    exchangeId: string;
    bucket0: string;          // stringified bigint
    bucket1: string;
    ts: number;
  };
}

export interface AlertButton {
  text: string;
  url: string;
}

export interface Alert {
  type: string;
  message: string;
  buttons?: AlertButton[][];  // rows of buttons
}
