import { ethers } from 'ethers';
import { config } from './config.js';

const REPUTATION_REGISTRY = '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63';
const IDENTITY_REGISTRY   = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';

// Try to call giveFeedback — falls back to a self-transfer if ABI mismatches
const FEEDBACK_ABI = [
  'function giveFeedback(uint256 agentId, bytes32[] calldata tags, int8[] calldata scores, string calldata comment) external',
];

export async function writeReceipt(
  wallet: ethers.Wallet,
  alertType: string,
  watchedWallet: string,
): Promise<string | null> {
  // Attempt 1: ERC-8004 giveFeedback
  try {
    const contract = new ethers.Contract(REPUTATION_REGISTRY, FEEDBACK_ABI, wallet);
    const tag = ethers.encodeBytes32String(alertType.slice(0, 31));
    const tx  = await contract.giveFeedback(
      config.agentId,
      [tag],
      [1],
      `Pulse: ${alertType} | ${watchedWallet.slice(0, 10)}`,
      { gasLimit: 200000 },
    );
    await tx.wait();
    console.log(`[Onchain] Receipt (giveFeedback): ${tx.hash}`);
    return tx.hash;
  } catch {
    // Attempt 2: Log activity via setAgentURI ping (identity registry)
    try {
      const agentURI = `https://raw.githubusercontent.com/Myles181/Pulse/main/agent.json`;
      const iface = new ethers.Interface(['function setAgentURI(uint256 tokenId, string memory agentURI) external']);
      const data  = iface.encodeFunctionData('setAgentURI', [config.agentId, agentURI]);
      const tx = await wallet.sendTransaction({
        to: IDENTITY_REGISTRY,
        data,
        gasLimit: 100000,
      });
      await tx.wait();
      console.log(`[Onchain] Receipt (setAgentURI): ${tx.hash}`);
      return tx.hash;
    } catch {
      // Attempt 3: Minimal self-transfer — always works, proves agent is active
      try {
        const agentAddr = await wallet.getAddress();
        const tx = await wallet.sendTransaction({
          to: agentAddr,
          value: ethers.parseEther('0.000001'),
          data: ethers.hexlify(ethers.toUtf8Bytes(`pulse:${alertType.slice(0, 20)}`)),
        });
        await tx.wait();
        console.log(`[Onchain] Receipt (self-tx): ${tx.hash}`);
        return tx.hash;
      } catch (err: any) {
        console.error('[Onchain] All receipt methods failed:', err?.shortMessage ?? err?.message);
        return null;
      }
    }
  }
}
