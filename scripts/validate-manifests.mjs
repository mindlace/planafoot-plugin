import { readFileSync, readdirSync } from 'node:fs';
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

// gemini-extension.json — Gemini native remote MCP
const gem = read('gemini-extension.json');
assert.equal(gem.name, 'planafoot', 'gemini-extension.json: name must be "planafoot"');
assert.ok(
  typeof gem.version === 'string' && gem.version.length,
  'gemini-extension.json: version required'
);
const gms = gem.mcpServers?.planafoot;
assert.ok(gms, 'gemini-extension.json: missing mcpServers.planafoot');
assert.equal(gms.httpUrl, ENDPOINT, `gemini-extension.json: planafoot.httpUrl must be ${ENDPOINT}`);
assert.ok(
  !('command' in gms) && !('args' in gms),
  'gemini-extension.json: no command/args (native remote)'
);

// All manifests must declare the same version
assert.equal(
  gem.version,
  plugin.version,
  `version drift: gemini-extension.json ${gem.version} != plugin.json ${plugin.version}`
);
assert.equal(
  market.metadata?.version,
  plugin.version,
  `version drift: marketplace.json metadata.version ${market.metadata?.version} != plugin.json ${plugin.version}`
);

// Exactly one shared skill — no per-agent duplication
const skillFiles = readdirSync('skills', { recursive: true }).filter((f) =>
  String(f).endsWith('SKILL.md')
);
assert.equal(
  skillFiles.length,
  1,
  `expected exactly one SKILL.md under skills/, found ${skillFiles.length}: ${skillFiles.join(', ')}`
);

console.log('All manifests valid.');
