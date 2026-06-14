import { ethers } from 'ethers';

// Identity Registry on Celo Mainnet
//const REGISTRY_ADDRESS = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';

const ABI = [
  'function register(string memory agentURI) external returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'
];

const PRIVATE_KEY = '0x0c8927ec53e8a4382b6fd131e5a246018fdc85b5ae5fec29bb3391d702cf1440';
const AGENT_URI = 'https://raw.githubusercontent.com/Myles181/Pulse/main/agent.json';

//const provider = new ethers.JsonRpcProvider('https://forno.celo.org');
//const provider = new ethers.JsonRpcProvider('https://alfajores-forno.celo-testnet.org');
const provider = new ethers.JsonRpcProvider('https://forno.celo.org');
const REGISTRY_ADDRESS = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'; // Celo Sepolia

const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const registry = new ethers.Contract(REGISTRY_ADDRESS, ABI, wallet);

async function register() {
  console.log('Registering Pulse agent...');
  const tx = await registry.register(AGENT_URI);
  console.log('Tx sent:', tx.hash);
  const receipt = await tx.wait();
  console.log('Confirmed!');
  
  // Extract agent ID from Transfer event
  const event = receipt.logs.find(log => {
    try { return registry.interface.parseLog(log).name === 'Transfer'; }
    catch { return false; }
  });
  const agentId = registry.interface.parseLog(event).args[2].toString();
  console.log('Your Agent ID:', agentId);
  console.log('Your 8004scan link: https://8004scan.io/agents/' + agentId);
}

register().catch(console.error);
