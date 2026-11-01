import { createServer } from 'node:http';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { address } from '../node_modules/@solana/kit/dist/index.node.mjs';
import { createSolanaRpcFromNetwork, fetchSwigAccount } from '../src/lib/svm/swig';

const config = address('So11111111111111111111111111111111111111112');
const network = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
let response: { status: number; result?: unknown; error?: unknown };

const server = createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    const { id } = JSON.parse(body || '{}') as { id: number };
    res.writeHead(response.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id, ...(response.error ? { error: response.error } : { result: response.result }) }));
  });
});
const endpoint = await new Promise<string>(resolve => {
  server.listen(0, '127.0.0.1', () => {
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    resolve(`http://127.0.0.1:${port}`);
  });
});
afterEach(() => { response = { status: 200 }; });
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

describe('Swig account lookup', () => {
  it('returns null only when the RPC confirms the account is absent', async () => {
    response = { status: 200, result: { context: { slot: 1 }, value: null } };
    expect(await fetchSwigAccount(createSolanaRpcFromNetwork(network, endpoint), config)).toBeNull();
  });

  it.each([
    { status: 429 },
    { status: 503 },
    { status: 200, error: { code: -32005, message: 'Node is behind' } },
  ])('preserves RPC failure %j instead of treating it as an absent account', async failure => {
    response = failure;
    await expect(fetchSwigAccount(createSolanaRpcFromNetwork(network, endpoint), config)).rejects.toThrow();
  });
});
