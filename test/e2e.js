// Esegue il codice DEPLOYATO dei nodi code, estratto da n8n, sui dati veri.
// Simula solo $input e $('Nodo'): il resto e' il codice tale e quale.
const fs = require('fs');
const vm = require('vm');

const raw = JSON.parse(fs.readFileSync(fs.existsSync('deployed.json') ? 'deployed.json' : 'workflows/model-routing-governor-demo.json', 'utf8'));
const wf = raw.workflow || raw;
const codeOf = name => wf.nodes.find(n => n.name === name).parameters.jsCode;

// --- input reali -------------------------------------------------------------
const inventoryNote = JSON.parse(fs.readFileSync('real-inventory-note.json', 'utf8'));
const aaResponse = JSON.parse(fs.readFileSync('aa-api.json', 'utf8'));
const crmNote = JSON.parse(fs.readFileSync('real-crm-note.json', 'utf8'));

const outputs = {};

function run(nodeName, inputJson, upstream) {
  const ctx = {
    $input: {
      first: () => ({ json: inputJson }),
      all: () => [{ json: inputJson }],
    },
    $: name => {
      if (!(name in upstream)) throw new Error(`$('${name}') non disponibile nel test`);
      return { first: () => ({ json: upstream[name] }), all: () => [{ json: upstream[name] }] };
    },
    console,
    Object, Array, Map, Set, Number, String, Math, JSON, Date, RegExp, Error, isNaN,
  };
  const res = vm.runInNewContext(`(function(){${codeOf(nodeName)}})()`, ctx, { timeout: 20000 });
  outputs[nodeName] = Array.isArray(res) && res.length ? res[0].json : null;
  return { items: res, json: outputs[nodeName] };
}

const step = (n, msg) => console.log(`\n[${n}] ${msg}`);
let failures = 0;
const check = (ok, label) => { console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures += 1; };

// --- 1. Build catalog -------------------------------------------------------
step(1, 'Build catalog — nota inventario reale x catalogo AA reale');
const build = run('Build catalog', aaResponse, { 'Read host inventory': inventoryNote });
const b = build.json;
console.log(`   host: ${b.hosts.join(', ')}`);
console.log(`   AA: ${b.aa_total} modelli | pavimento: ${b.floor_model} = ${b.floor}`);
console.log(`   catalogo: ${b.catalog.length} | tagliati: ${b.cut.length} | locali: ${b.locals.length}`);
console.log(`   non agganciati: ${b.unmatched.join(', ') || 'nessuno'}`);
console.log(`   impronta: ${b.fingerprint}`);
check(b.aa_total > 500, 'catalogo AA scaricato per intero');
check(b.catalog.length > 5, 'catalogo non vuoto dopo il pavimento');
check(Math.abs(b.floor - 49.9) < 0.01, 'pavimento = DeepSeek V4 Flash (New) a 49.9');
check(b.hosts.length >= 1, 'almeno un host ha pubblicato');
check(/^[0-9a-f]+$/.test(b.fingerprint), 'impronta calcolata');

// --- 2. Route roles ---------------------------------------------------------
step(2, 'Route roles — nove ruoli, test e politiche per ruolo');
const route = run('Route roles', b, {});
const r = route.json;
console.log('   ruolo      politica         primario                 fallback1                fallback2                pool');
for (const x of r.routing) {
  if (x.unassigned) { console.log(`   ${x.role.id.padEnd(10)} ${x.role.profile.padEnd(16)} NON ASSEGNATO`); continue; }
  const f = i => (x.picks[i] ? `${x.picks[i].name}@${x.picks[i].cli}` : '').padEnd(25);
  console.log(`   ${x.role.id.padEnd(10)} ${x.role.profile.padEnd(16)} ${f(0)}${f(1)}${f(2)}${x.pools.length}/3`);
}
check(r.routing.length === 9, 'nove ruoli valutati');
const assigned = r.routing.filter(x => !x.unassigned);
check(assigned.length === 8, 'otto assegnati, Privacy no (nessun locale su questo host)');
check(assigned.every(x => x.picks.length === 3), 'ogni ruolo assegnato ha primario + due fallback');
check(assigned.every(x => x.pools.length === 3), 'ogni ruolo su tre pool di quota distinti');
check(r.routing.find(x => x.role.id === 'Privacy').unassigned, 'Privacy non assegnato invece di ricadere su un cloud');

// confronto con la matrice di riferimento calcolata fuori da n8n
const ref = JSON.parse(fs.readFileSync('reference-matrix.json', 'utf8'));
const got = assigned.map(x => `${x.role.id}:${x.picks.map(p => `${p.name}@${p.cli}`).join(',')}`);
const same = ref.length === got.length && ref.every(v => got.includes(v));
check(same, 'matrice identica a quella verificata fuori da n8n');
if (!same) {
  console.log('   riferimento:', JSON.stringify(ref, null, 1));
  console.log('   ottenuto:   ', JSON.stringify(got, null, 1));
}

// --- 3. Render CRM block ----------------------------------------------------
step(3, 'Render CRM block');
const render = run('Render CRM block', r, {});
const block = render.json.block;
console.log(`   blocco: ${block.split('\n').length} righe, ${block.length} caratteri`);
check(block.startsWith('<!-- model-routing-governor:start -->'), 'delimitatore di apertura');
check(block.trimEnd().endsWith('<!-- model-routing-governor:end -->'), 'delimitatore di chiusura');
check(block.includes(`input=${b.fingerprint}`), 'impronta scritta nel blocco');
check(!/undefined|NaN|\[object/.test(block), 'nessun undefined, NaN o [object Object] nel markdown');
check((block.match(/^#### /gm) || []).length === 9, 'una sezione per ognuno dei nove ruoli');

// --- 4. Assemble update -----------------------------------------------------
step(4, 'Assemble update — innesto nella nota e guard transazionale');
const asm = run('Assemble update', crmNote, { 'Render CRM block': render.json });
if (!asm.items.length) {
  console.log('   il nodo ha restituito [] : impronta invariata, nessuna riscrittura');
  check(true, 'guard sull impronta funziona (uscita senza scrivere)');
} else {
  const a = asm.json;
  console.log(`   contenuto: ${a.content.length} caratteri | hash atteso: ${String(a.expected_hash).slice(0, 12)}…`);
  console.log(`   impronta: ${a.previous_fingerprint} -> ${a.fingerprint}`);
  console.log(`   assegnati: ${a.assigned}/9 | non assegnati: ${a.unassigned.join(', ')}`);
  check(!!a.expected_hash, 'expected_hash allegato: la scrittura e transazionale');
  check(a.content.includes('## Contratto operativo'), 'il resto della nota e intatto');
  check(a.content.includes('<!-- model-routing-governor:start -->'), 'blocco innestato');
  check((a.content.match(/model-routing-governor:start/g) || []).length === 1, 'un solo blocco, non duplicato');
  fs.writeFileSync('e2e-result.md', a.content);
}

// --- verdetto ---------------------------------------------------------------
console.log(`\n${'='.repeat(70)}`);
console.log(failures ? `${failures} CONTROLLI FALLITI` : 'TUTTI I CONTROLLI PASSATI');
process.exit(failures ? 1 : 0);
