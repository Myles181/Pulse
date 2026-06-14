import { IdentityRegistry } from '@chaoschain/sdk';

const registry = new IdentityRegistry(provider);
const agentURI = 'ipfs://QmYourHostedJSON'; // Must be live URL
const tx = await registry.register(agentURI);
