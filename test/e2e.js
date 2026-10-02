// Runs the shipped Code nodes on captured inputs, without network or writes.
// Input files stay outside the repository; see README for the capture contract.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const read = name => JSON.parse(fs.readFileSync(name, 'utf8'));
const fallback = path.join(__dirname, '..', 'workflows', 'model-routing-governor-demo.json');
const raw = read(fs.existsSync('deployed.json') ? 'deployed.json' : fallback);
const wf = raw.workflow || raw;
const codeOf = name => wf.nodes.find(n => n.name === name).parameters.jsCode;
const nodes = {
  'Read host inventory': read('real-inventory-note.json'),
  'Fetch AA catalog': read('aa-api.json'),
  'Fetch Zen catalog': read('zen-api.json'),
  'Fetch models.dev': read('models-dev.json'),
};
function run(name, input) {
  const result = new Function('$', '$input', codeOf(name))(
    n => ({ first: () => ({ json: nodes[n] }) }),
    { first: () => ({ json: input }) },
  );
  if (result.length) nodes[name] = result[0].json;
  return result;
}
const built = run('Build catalog', null)[0].json;
assert(built.hosts.length > 0);
assert(built.aa_total > 0);
assert(built.catalog.length > 0);
assert(/^[0-9a-f]+$/.test(built.fingerprint));
const routed = run('Route roles', built)[0].json;
assert.equal(routed.routing.length, 10);
for (const role of routed.routing) {
  if (role.unassigned) continue;
  assert(role.picks.length > 0);
  if (role.role.id === 'Privacy') assert(role.picks.every(p => p.pool === 'local' && p.klass === 'local'));
  else assert.equal(new Set(role.picks.map(p => p.pool)).size, role.picks.length);
  if (role.role.data !== 'none') assert.equal(role.free, null);
}
if (fs.existsSync('reference-matrix.json')) assert.deepEqual(routed.routing, read('reference-matrix.json'));
const rendered = run('Render CRM block', routed)[0].json;
assert(rendered.block.includes(`input=${built.fingerprint}`));
assert(rendered.block.includes('<!-- model-routing-governor:start -->'));
assert(rendered.block.trimEnd().endsWith('<!-- model-routing-governor:end -->'));
assert(!/undefined|NaN|\[object Object\]/.test(rendered.block));
const assembled = run('Assemble update', read('real-crm-note.json'));
if (assembled.length) {
  assert(assembled[0].json.expected_hash);
  assert(assembled[0].json.content.includes(rendered.block));
}
const same = { content: [{ type: 'text', text: {full_content: rendered.block, content_hash: 'synthetic-noop-check'} }] };
assert.equal(run('Assemble update', same).length, 0);
console.log('PASS: captured inputs, 10 roles, pool/privacy invariants, transactional update and unchanged-input no-op.');
