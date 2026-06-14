import { ethers } from "ethers";
import "dotenv/config";

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL!);
  const signer = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

  const contractAddress = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
  const abi = [
    "function register() returns (uint256)",
    "function setAgentURI(uint256 agentId, string memory uri) external",
  ];

  const registry = new ethers.Contract(contractAddress, abi, signer);

  console.log("Registering agent...");
  const tx = await registry.register();
  const receipt = await tx.wait();
  console.log("TX hash:", receipt.hash);

  const agentId = receipt.logs[0].topics[3];
  const agentIdDecimal = BigInt(agentId).toString();
  console.log("Agent ID:", agentIdDecimal);

  console.log("Setting agent URI...");
  const uri = "https://raw.githubusercontent.com/Myles181/Pulse/main/agent.json";
  const tx2 = await registry.setAgentURI(agentIdDecimal, uri);
  await tx2.wait();
  console.log("Done! Your link: https://8004scan.io/agents/" + agentIdDecimal);
}

main().catch(console.error);
