// Estratto dal workflow (nodo `Build catalog`) — versione esattamente deployata.
// Fonte unica: workflows/model-routing-governor-demo.json.
// Inventario (nota vault, pubblicato per host) x punteggi Artificial Analysis.
// ---------------------------------------------------------------------------
// Classi di canale. Il prezzo vuole dire una cosa diversa in ognuna, ed e' il
// motivo per cui la v3 sbagliava: usava il listino AA per tutti.
//   flat  abbonamento vero (Claude, Codex, AGY): il prezzo NON esiste
//   quota budget da 60$/mese a prezzi API (Go): il prezzo e' velocita' di consumo
//   free  Zen gratis: zero, ma contesto ridotto, coda che sfratta, dato nel training
//   cash  Zen a pagamento: soldi veri, unica corsia dove qualita'/prezzo e' onesto
//   local Ollama: fuori classifica, serve solo a Privacy
// Da alzare a ogni modifica della logica: entra nell'impronta, ed e' cio' che
// fa ripubblicare il CRM quando cambia il codice e non i dati.
const LOGIC_VERSION = 'v4.15';
const CLASS = { FLAT: 'flat', QUOTA: 'quota', FREE: 'free', CASH: 'cash', LOCAL: 'local' };
const FLAT_CLIS = new Set(['claude', 'codex', 'agy']);

// Sbarra sullo Zen a pagamento. Sopra questa cifra non stai tamponando
// un'emergenza, stai ricomprando qualcosa che hai gia' in abbonamento.
const CASH_BAR = 3;

// ---------------------------------------------------------------------------
// Normalizzazione dei nomi. AA usa un vocabolario di suffissi ricco che va
// spogliato prima di confrontare con gli slug esposti dai canali.
const EFFORT = /\s+\((?:adaptive\s+)?(?:non-)?reasoning(?:,\s*[a-z]+\s+effort)?(?:,\s*[^)]*fallback)?\)$/i;
const LEVEL = /\s+\((?:max|xhigh|high|medium|low|minimal|with fallback|preview)\)$/i;
const DATED = /\s+\((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s*'?\d{2}\)$/i;
const BARE = /\s+Preview$/i;

function canonical(v) {
  let o = String(v || '').trim();
  for (let i = 0; i < 4; i += 1) {
    const b = o;
    o = o.replace(EFFORT, '').replace(LEVEL, '').replace(DATED, '').replace(BARE, '').trim();
    if (o === b) break;
  }
  return o;
}
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const SLUG = /-(high|medium|low|max|xhigh|minimal|thinking|reasoning|free|code|mini|contributor)$/;

// Un tag build in coda ('DeepSeek V4 Flash 0731') e' la stessa famiglia dello
// slug generico che il canale espone. Riconoscerlo come data MMDD invece che
// come "quattro cifre" e' quello che distingue 0731 da 'R1 1776', dove il
// numero e' parte del nome: mese 17 non esiste, quindi 1776 non e' una build.
function buildTag(name) {
  const m = /\s+(\d{4})$/.exec(String(name || ''));
  if (!m) return null;
  const mm = Number(m[1].slice(0, 2)), dd = Number(m[1].slice(2));
  return (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) ? m[1] : null;
}

function buildAaIndex(models) {
  const index = new Map();
  for (const m of models) {
    const sc = m.evaluations && m.evaluations.artificial_analysis_intelligence_index;
    if (!Number.isFinite(sc)) continue;
    const k = norm(canonical(m.name));
    const p = index.get(k);
    if (!p || p.evaluations.artificial_analysis_intelligence_index < sc) index.set(k, m);
  }
  // La build piu' recente risponde anche allo slug senza tag: il canale serve
  // la corrente, non una versione congelata. Si registra la migliore.
  for (const [, m] of [...index]) {
    const c = canonical(m.name);
    if (!buildTag(c)) continue;
    const base = norm(c.replace(/\s+\d{4}$/, ''));
    const cur = index.get(base);
    if (!cur || cur.evaluations.artificial_analysis_intelligence_index < m.evaluations.artificial_analysis_intelligence_index) index.set(base, m);
  }
  return index;
}

function makeLookup(index) {
  return function lookup(slug) {
    let b = String(slug).split('/').pop().trim();
    for (let i = 0; i < 4; i += 1) {
      const hit = index.get(norm(b));
      if (hit) return hit;
      const s = b.replace(SLUG, '');
      if (s === b) break;
      b = s;
    }
    return null;
  };
}

// I prezzi restano cifre da leggere, non binario grezzo: senza arrotondare,
// (0.14*3+0.28)/4 stampa 0.17500000000000002 dentro il CRM.
const money = (v) => (Number.isFinite(v) ? Math.round(v * 10000) / 10000 : v);
const blended = (cost) => {
  if (!cost) return null;
  const i = cost.input, o = cost.output;
  return (Number.isFinite(i) && Number.isFinite(o)) ? money((i * 3 + o) / 4) : null;
};

// ---------------------------------------------------------------------------
// FASE 1 — catalogo
// Fonti separate per competenza: AA dice quanto e' bravo, models.dev quanto
// costa SU QUEL CANALE e quanto contesto regge, l'API Zen dice cosa Zen serve
// davvero adesso. La nota inventario resta solo per cio' che vive sul PC.
function buildCatalog({ noteBody, aaModels, zenIds, modelsDev, minAa }) {
  const MIN_AA = Number.isFinite(minAa) ? minAa : 50;
  if (!String(noteBody || '').trim()) throw new Error('Nota inventario vuota o illeggibile');
  if (!Array.isArray(aaModels) || aaModels.length < MIN_AA) throw new Error('Catalogo AA sospetto: ' + (aaModels || []).length + ' modelli');

  const hosts = {};
  const blockRe = /<!-- model-inventory:([^:]+):start -->([\s\S]*?)<!-- model-inventory:\1:end -->/g;
  let bm;
  while ((bm = blockRe.exec(noteBody))) {
    const chans = {};
    const lineRe = /^-\s+\*\*([a-z]+)\*\*[^:]*:\s*(.+)$/gm;
    let lm;
    while ((lm = lineRe.exec(bm[2]))) {
      const list = [...lm[2].matchAll(/`([^`]+)`/g)].map((x) => x[1]);
      if (list.length) chans[lm[1]] = list;
    }
    hosts[bm[1]] = chans;
  }
  if (!Object.keys(hosts).length) throw new Error('Nessun blocco host nella nota');

  const index = buildAaIndex(aaModels);
  const lookup = makeLookup(index);
  const goDev = (modelsDev['opencode-go'] || {}).models || {};
  const zenDev = (modelsDev.opencode || {}).models || {};

  const inv = new Map();
  const unmatched = [];
  const add = (key, entry) => { if (!inv.has(key)) inv.set(key, entry); };

  const enrich = (hit, dev) => {
    const pr = hit.pricing || {};
    const lim = (dev && dev.limit) || {};
    return {
      name: canonical(hit.name),
      idx: hit.evaluations.artificial_analysis_intelligence_index,
      tps: hit.median_output_tokens_per_second,
      ev: hit.evaluations,
      ctx: lim.context || null,
      out: lim.output || null,
      aaPrice: pr.price_1m_blended_3_to_1,
    };
  };

  // -- canali che vivono sul PC: li conosce solo l'inventario --------------
  for (const [host, chans] of Object.entries(hosts)) {
    for (const [cli, slugs] of Object.entries(chans)) {
      for (const slug of slugs) {
        if (cli === 'local') {
          add('local|' + slug, { name: slug, cli: 'local', klass: CLASS.LOCAL, pool: 'local', exposed: slug, host, idx: null, price: 0, tps: null, ctx: null, ev: {} });
          continue;
        }
        if (!FLAT_CLIS.has(cli)) continue; // opencode arriva dalle fonti remote
        const hit = lookup(slug);
        if (!hit) { unmatched.push(cli + '/' + slug); continue; }
        const e = enrich(hit, null);
        // Prezzo assente di proposito: su abbonamento vero non si consuma nulla.
        add(cli + '|' + e.name, Object.assign(e, { cli, klass: CLASS.FLAT, pool: cli, exposed: slug, host, price: null }));
      }
    }
  }

  const hasOpencode = Object.values(hosts).some((c) => c.opencode && c.opencode.length);

  // -- Go: catalogo da models.dev, non dal PC ------------------------------
  if (hasOpencode) {
    for (const [id, dev] of Object.entries(goDev)) {
      const hit = lookup(id);
      if (!hit) { unmatched.push('opencode-go/' + id); continue; }
      const price = blended(dev.cost);
      if (price === null) continue;
      const e = enrich(hit, dev);
      add('go|' + e.name, Object.assign(e, { cli: 'opencode-go', klass: CLASS.QUOTA, pool: 'go', exposed: 'opencode-go/' + id, host: 'remoto', price }));
    }
  }

  // -- Zen: catalogo dall'API Zen, prezzi e contesto da models.dev ---------
  const zenServed = new Set((zenIds || []).map(norm));
  for (const [id, dev] of Object.entries(zenDev)) {
    if (zenServed.size && !zenServed.has(norm(id))) continue; // Zen non lo serve piu'
    const price = blended(dev.cost);
    if (price === null) continue;
    const isFree = price === 0;
    const hit = lookup(id);
    if (!hit) { unmatched.push('zen/' + id); continue; }
    const e = enrich(hit, dev);
    if (isFree) {
      add('zenfree|' + e.name, Object.assign(e, { cli: 'zen-free', klass: CLASS.FREE, pool: 'zen-free', exposed: 'opencode/' + id, host: 'remoto', price: 0 }));
    } else {
      add('zenpaid|' + e.name, Object.assign(e, { cli: 'zen', klass: CLASS.CASH, pool: 'zen', exposed: 'opencode/' + id, host: 'remoto', price }));
    }
  }

  // -- NVIDIA: disponibilita' dall'endpoint vivo, metadati da models.dev -----
  // Le due fonti NON coincidono, e la differenza non e' cosmetica: models.dev
  // espone ancora `deepseek-ai/deepseek-v4-pro` e `deepseek-v4-flash` quando
  // l'endpoint risponde 410 Gone, e `moonshotai/kimi-k2.6` che da' 404. Vince
  // sempre l'inventario, che e' stato sondato chiamando `/v1/models` davvero.
  //
  // Il catalogo vivo contiene anche embedding, guardrail, OCR e retriever:
  // NON finiscono in `unmatched`, perche' non sono modelli di chat che ad AA
  // mancano -- sono un altro mestiere, e non c'e' niente da valutare.
  const nimDev = (modelsDev.nvidia || {}).models || {};
  let nimAltroMestiere = 0;
  for (const chans of Object.values(hosts)) {
    for (const id of chans.nvidia || []) {
      const dev = nimDev[id];
      if (!dev || !(dev.limit && dev.limit.context)) { nimAltroMestiere += 1; continue; }
      const hit = lookup(id);
      if (!hit) { unmatched.push('nvidia/' + id); continue; }
      const e = enrich(hit, dev);
      // Gratis come lo Zen free, ma per un motivo diverso: qui il contesto e'
      // quello pieno e non c'e' coda che sfratta. Si paga in richieste al
      // minuto e in prompt loggati, non in qualita' del modello.
      add('nim|' + e.name, Object.assign(e, {
        cli: 'nvidia', klass: CLASS.FREE, pool: 'nvidia',
        exposed: 'nvidia/' + id, host: 'remoto', price: 0,
      }));
    }
  }

  // Una generazione vecchia esposta accanto alla nuova e' rumore: `agy` serve
  // ancora Gemini 3.5 Flash mentre c'e' il 3.6, e proporlo vuol dire proporre
  // qualcosa che il fornitore sta per spegnere. Si tiene la versione piu' alta
  // DENTRO OGNI CANALE: un canale che ha solo la vecchia se la tiene, perche'
  // per lui non e' vecchia, e' l'unica.
  //
  // Nota: puo' scartare un modello con indice AA piu' alto (Gemini 3.5 Flash
  // sta a 52.0 e il 3.6 a 51.6). E' voluto -- l'anzianita' batte due decimi.
  const famiglia = (nome) => {
    const pulito = buildTag(nome) ? nome.replace(/\s+\d{4}$/, '') : nome;
    const m = /(\d+(?:\.\d+)?)/.exec(pulito);
    if (!m) return { fam: norm(pulito), ver: null };
    return { fam: norm(pulito.slice(0, m.index) + pulito.slice(m.index + m[1].length)), ver: parseFloat(m[1]) };
  };
  const migliori = new Map();
  for (const m of inv.values()) {
    const { fam, ver } = famiglia(m.name);
    const k = m.pool + '|' + fam;
    const p = migliori.get(k);
    if (!p || ver === null || (p.ver !== null && ver > p.ver)) migliori.set(k, { ver, entry: m });
  }
  const vive = new Set([...migliori.values()].map((x) => x.entry));
  const superati = [...inv.values()].filter((m) => !vive.has(m)).map((m) => m.pool + '/' + m.name);
  for (const [k, m] of [...inv]) if (!vive.has(m)) inv.delete(k);

  const all = [...inv.values()];
  const byClass = (k) => all.filter((m) => m.klass === k);

  // Pavimento: un MODELLO di riferimento, non una soglia scelta a mano.
  const ref = all.find((m) => m.klass === CLASS.QUOTA && /^DeepSeek V4 Flash/i.test(m.name))
    || all.find((m) => /^DeepSeek V4 Flash/i.test(m.name));
  const FLOOR = ref && Number.isFinite(ref.idx) ? ref.idx : 40;

  const scored = all.filter((m) => m.klass !== CLASS.LOCAL && Number.isFinite(m.idx));
  const catalog = scored.filter((m) => m.idx >= FLOOR).sort((a, b) => b.idx - a.idx);
  const cut = scored.filter((m) => m.idx < FLOOR).sort((a, b) => b.idx - a.idx);

  // Frontiera qualita'/prezzo sullo Zen a pagamento: resta solo chi non e'
  // battuto da qualcuno insieme piu' bravo E piu' economico. La sbarra poi
  // taglia la coda cara, che in emergenza non ha senso ricomprare.
  const cashAll = catalog.filter((m) => m.klass === CLASS.CASH);
  const frontier = cashAll.filter((m) => !cashAll.some((o) => o.price < m.price && o.idx > m.idx));
  const cash = frontier.filter((m) => m.price <= CASH_BAR).sort((a, b) => b.idx - a.idx);
  const cashCut = frontier.filter((m) => m.price > CASH_BAR).sort((a, b) => b.idx - a.idx);

  function fnv(s) { let h = 2166136261; for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
  // LOGIC_VERSION entra nell'impronta perche' l'impronta deve rappresentare
  // QUELLO CHE VERREBBE SCRITTO, non solo i dati in ingresso. Senza, una
  // correzione al routing a catalogo invariato non viene mai pubblicata: e'
  // successo con il ruolo Privacy, che restava vuoto nel CRM mentre in locale
  // era gia' assegnato. Va alzata a ogni modifica della logica.
  const fingerprint = fnv(LOGIC_VERSION + '#'
    + catalog.map((m) => m.pool + ':' + m.name + ':' + m.idx + ':' + m.price).sort().join('|')
    + '#' + byClass(CLASS.LOCAL).map((m) => m.host + ':' + m.name).sort().join('|'));

  return {
    catalog, cut, cash, cashCut, cashBar: CASH_BAR,
    locals: byClass(CLASS.LOCAL),
    free: catalog.filter((m) => m.klass === CLASS.FREE),
    floor: FLOOR,
    floor_model: ref ? ref.name : '(assente)',
    hosts: Object.keys(hosts),
    aa_total: aaModels.length,
    zen_total: (zenIds || []).length,
    nim_altro_mestiere: nimAltroMestiere,
    // Due host che espongono lo stesso modello lo segnalano due volte: e' un
    // fatto sull'inventario, non due problemi diversi da risolvere.
    unmatched: [...new Set(unmatched)].sort(),
    superati: superati.sort(),
    fingerprint,
  };
}


const note = $('Read host inventory').first().json;
// Il nodo MCP incarta la risposta: { content: [ { type: 'text', text: <nota> } ] },
// e 'text' arriva GIA' come oggetto, non come stringa JSON. Senza sbucciare,
// String(note.content) diventa '[object Object]' e nessun blocco host viene
// trovato -- che e' esattamente come questo bug si e' manifestato nella v3.
const rawNote = (note.content && note.content[0] && note.content[0].text) || note;
const notePayload = typeof rawNote === 'string' ? JSON.parse(rawNote) : rawNote;
const noteBody = String(notePayload.full_content || notePayload.content || '');

const aa = $('Fetch AA catalog').first().json;
const zen = $('Fetch Zen catalog').first().json;
const dev = $('Fetch models.dev').first().json;

const zenIds = Array.isArray(zen && zen.data) ? zen.data.map(m => m.id) : [];
if (!zenIds.length) throw new Error('Catalogo Zen vuoto: senza non si distingue free da pagamento');
if (!dev || !dev['opencode-go'] || !dev.opencode) throw new Error('models.dev senza i provider opencode: prezzi per canale non ricavabili');

const out = buildCatalog({
  noteBody,
  aaModels: Array.isArray(aa && aa.data) ? aa.data : [],
  zenIds,
  modelsDev: dev,
});
return [{ json: out }];

