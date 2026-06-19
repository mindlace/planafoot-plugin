import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const ENDPOINT = 'https://planafoot.com/mcp';
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

// .mcp.json — Claude native remote MCP, no mcp-remote shim
const mcp = read('.mcp.json');
const cms = mcp.mcpServers?.planafoot;
assert.ok(cms, '.mcp.json: missing mcpServers.planafoot');
assert.equal(cms.type, 'http', '.mcp.json: planafoot.type must be "http"');
assert.equal(cms.url, ENDPOINT, `.mcp.json: planafoot.url must be ${ENDPOINT}`);
assert.ok(!('command' in cms) && !('args' in cms), '.mcp.json: no command/args (drop mcp-remote)');

// .claude-plugin/plugin.json
const plugin = read('.claude-plugin/plugin.json');
assert.equal(plugin.name, 'planafoot', 'plugin.json: name must be "planafoot"');
assert.ok(plugin.version, 'plugin.json: version required');

// .claude-plugin/marketplace.json
const market = read('.claude-plugin/marketplace.json');
assert.equal(market.name, 'planafoot', 'marketplace.json: name must be "planafoot"');
const entry = market.plugins?.find((p) => p.name === 'planafoot');
assert.ok(entry, 'marketplace.json: missing planafoot plugin entry');
assert.equal(entry.source, './', 'marketplace.json: planafoot source must be "./"');

console.log('All manifests valid.');
