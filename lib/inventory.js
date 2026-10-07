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
const LOGIC_VERSION = 'v4.31';
const CLASS = { FLAT: 'flat', QUOTA: 'quota', FREE: 'free', CASH: 'cash', LOCAL: 'local' };
const FLAT_CLIS = new Set(['claude', 'codex', 'agy']);
const RETIRED_REGISTRY = {
  "gpt-5.5": { retired_at: "2026-08-01", reason: "superseded by gpt-6 series", source: "openai-deprecation-notice" },
  "gpt-5.5-pro": { retired_at: "2026-08-01", reason: "superseded by gpt-6 series", source: "openai-deprecation-notice" },
  "gpt-5.5-fast": { retired_at: "2026-08-01", reason: "superseded by gpt-6 series", source: "openai-deprecation-notice" },
  "gpt-5.4-nano": { retired_at: "2026-08-01", reason: "superseded by gpt-6 series", source: "openai-deprecation-notice" },
  "gpt-5.4-mini": { retired_at: "2026-08-01", reason: "superseded by gpt-6 series", source: "openai-deprecation-notice" },
  "gpt-5.3-codex": { retired_at: "2026-08-01", reason: "superseded by gpt-6 series", source: "openai-deprecation-notice" },
  "claude-3-opus-20240229": { retired_at: "2025-12-01", reason: "superseded by opus 4/5 series", source: "anthropic-deprecation-notice" },
  "claude-sonnet-4-6": { retired_at: "2026-09-01", reason: "superseded by claude-5 series", source: "anthropic-deprecation-notice" },
  "claude-opus-4-6": { retired_at: "2026-09-01", reason: "superseded by claude-5 series", source: "anthropic-deprecation-notice" },
  "claude-opus-4-6-thinking": { retired_at: "2026-09-01", reason: "superseded by claude-5 series", source: "anthropic-deprecation-notice" },
  "claude-haiku-4-5": { retired_at: "2026-09-01", reason: "superseded by claude-5 series", source: "anthropic-deprecation-notice" },
  "gemini-3.5-flash-lite": { retired_at: "2026-09-01", reason: "superseded by gemini-3.8 series", source: "google-deprecation-notice" },
  "gemini-3.1-pro": { retired_at: "2026-09-01", reason: "superseded by gemini-3.8 series", source: "google-deprecation-notice" },
  "gemini-3.1-pro-high": { retired_at: "2026-09-01", reason: "superseded by gemini-3.8 series", source: "google-deprecation-notice" },
  "gemini-3.1-pro-low": { retired_at: "2026-09-01", reason: "superseded by gemini-3.8 series", source: "google-deprecation-notice" },
  "ling-3.0-flash-fin-free": { retired_at: "2026-09-01", reason: "superseded by ling-3.1 series", source: "ling-deprecation-notice" },
  "mimo-v2.5": { retired_at: "2026-09-01", reason: "superseded by mimo-v2.6 series", source: "xiaomi-deprecation-notice" },
  "mimo-v2.5-free": { retired_at: "2026-09-01", reason: "superseded by mimo-v2.6 series", source: "xiaomi-deprecation-notice" },
};
const RETIRED_MODELS = new Set(Object.keys(RETIRED_REGISTRY));

function isRetiredModel(slug, name) {
  const b = String(slug || '').split('/').pop().trim().toLowerCase();
  if (RETIRED_MODELS.has(b)) return true;
  const n = norm(name || '');
  for (const r of RETIRED_MODELS) {
    if (b === r || n === norm(r)) return true;
  }
  return false;
}

const CANONICAL_ALIASES = {
  "claude-opus-5-5": { name: "Claude Opus 5.5", variant: "max" },
  "claude-sonnet-5-5": { name: "Claude Sonnet 5.5", variant: "max" },
  "claude-fable-5-1": { name: "Claude Fable 5.1", variant: "max" },
  "claude-opus-5": { name: "Claude Opus 5", variant: "default" },
  "claude-sonnet-5": { name: "Claude Sonnet 5", variant: "default" },
  "gemini-3.8-flash-high": { name: "Gemini 3.8 Flash", variant: "high" },
  "gemini-3.8-flash": { name: "Gemini 3.8 Flash", variant: "default" },
  "gpt-6-luna": { name: "GPT-6 Luna", variant: "default" },
  "gpt-6.1-sol": { name: "GPT-6.1 Sol", variant: "default" },
  "gpt-5.6-terra": { name: "GPT-5.6 Terra", variant: "default" },
};

// Sbarra sullo Zen a pagamento. Sopra questa cifra non stai tamponando
// un'emergenza, stai ricomprando qualcosa che hai gia' in abbonamento.
const CASH_BAR = 3;

// ---------------------------------------------------------------------------
// Normalizzazione dei nomi. AA usa un vocabolario di suffissi ricco che va
// spogliato prima di confrontare con gli slug esposti dai canali.
const EFFORT = /\s+\((?:adaptive\s+)?(?:non-)?reasoning(?:,\s*[a-z]+\s+effort)?(?:,\s*[^)]*fallback)?\)$/i;
const LEVEL = /\s+\((?:max|xhigh|high|medium|low|minimal|with fallback|preview)(?:,\s*[^)]*fallback)?\)$/i;
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

// Livello di effort dichiarato: uno slug low non deve mai ereditare il
// punteggio della variante high della stessa famiglia. Senza questa
// distinzione il Governor proponeva l'economica come se avesse la qualita'
// della migliore, e nessuna taratura dei pesi lo correggeva.
function effortOf(name) {
  // "Non-reasoning" dice che il ragionamento NON c'e': toglierlo prima,
  // o il token "reasoning" dentro promuove la variante a high.
  const s = String(name || '').replace(/non[-\s]?reasoning/i, '');
  // Prima il suffisso: e' lui a dire l'effort invocato. Cercare i token
  // in tutto il nome scambia `foo-reasoning-low` per high solo perche'
  // contiene "reasoning".
  const tail = (s.match(/-([A-Za-z]+)$/) || [])[1];
  const rank = (w) => {
    const v = String(w || '').toLowerCase();
    if (['max', 'xhigh', 'high', 'thinking', 'reasoning'].includes(v)) return 'high';
    if (v === 'medium') return 'medium';
    if (['low', 'minimal', 'mini', 'lite'].includes(v)) return 'low';
    return null;
  };
  if (tail) {
    const r = rank(tail);
    if (r) return r;
  }
  // Vince l'ULTIMO token di effort: in "Foo Reasoning (Low)" la parola
  // "reasoning" e' la famiglia, "(Low)" e' il livello. Cercare high per
  // primo promuoveva tutto cio' che contiene "reasoning".
  const words = s.toLowerCase().match(/[a-z]+/g) || [];
  let found = null;
  for (const w of words) {
    const r = rank(w);
    if (r) found = r;
  }
  return found;
}

function buildAaIndex(models) {
  const index = new Map();
  const push = (k, m) => {
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(m);
  };
  for (const m of models) {
    const sc = m.evaluations && m.evaluations.artificial_analysis_intelligence_index;
    if (!Number.isFinite(sc)) continue;
    push(norm(canonical(m.name)), m);
  }
  // La build piu' recente risponde anche allo slug senza tag: il canale serve
  // la corrente, non una versione congelata. Si registra sotto entrambe.
  // Copie statiche a entrambi i livelli: push() allunga gli array, e
  // iterare un array che cresce non termina mai piu'.
  for (const arr of [...index.values()].map((a) => [...a])) {
    for (const m of arr) {
      const c = canonical(m.name);
      if (!buildTag(c)) continue;
      push(norm(c.replace(/\s+\d{4}$/, '')), m);
    }
  }
  for (const arr of index.values()) {
    arr.sort((a, b) => b.evaluations.artificial_analysis_intelligence_index - a.evaluations.artificial_analysis_intelligence_index);
  }
  return index;
}

function makeLookup(index) {
  return function lookup(slug) {
    let b = String(slug).split('/').pop().trim();
    const alias = CANONICAL_ALIASES[b];
    if (alias) {
      const arr = index.get(norm(canonical(alias.name)));
      if (arr && arr.length) {
        return Object.assign({}, arr[0], { variant: alias.variant });
      }
    }
    const want = effortOf(b);
    for (let i = 0; i < 4; i += 1) {
      const arr = index.get(norm(b));
      if (arr && arr.length) {
        if (!want) return arr[0];
        const same = arr.find((m) => effortOf(m.name) === want);
        // Effort noto ma variante non misurata: null, cioe' "non valutabile",
        // mai il punteggio della famiglia. Finisce in unmatched, in vista.
        if (same) return same;
        return null;
      }
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
      variant: hit.variant || effortOf(hit.name) || 'default',
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
        if (isRetiredModel(slug, '')) continue;
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
      if (isRetiredModel(id, '')) continue;
      if (!hit) { unmatched.push('opencode-go/' + id); continue; }
      const price = blended(dev.cost);
      if (price === null) continue;
      const e = enrich(hit, dev);
      add('go|' + e.name, Object.assign(e, { cli: 'opencode-go', klass: CLASS.QUOTA, pool: 'go', exposed: 'opencode-go/' + id, host: 'remoto', price }));
    }
  }

  // -- Diretto (v4.27, in attesa del mapping canali nel Council):
  // pool `direct` da chiave DeepSeek su opencode. Il blocco e parcheggiato
  // in `docs/agent-lanes-direct-v427.md` finche `routing.py` non conosce
  // il canale: pubblicare righe direct prima romperebbe `council propose`.

  // -- Zen: catalogo dall'API Zen, prezzi e contesto da models.dev ---------
  const zenServed = new Set((zenIds || []).map(norm));
  for (const [id, dev] of Object.entries(zenDev)) {
    if (zenServed.size && !zenServed.has(norm(id))) continue; // Zen non lo serve piu'
    const price = blended(dev.cost);
    if (price === null) continue;
    const isFree = price === 0;
    const hit = lookup(id);
    if (isRetiredModel(id, '')) continue;
    if (!hit) { unmatched.push('zen/' + id); continue; }
    const e = enrich(hit, dev);
    if (isFree) {
      add('zenfree|' + e.name, Object.assign(e, { cli: 'zen-free', klass: CLASS.FREE, pool: 'zen-free', exposed: 'opencode/' + id, host: 'remoto', price: 0 }));
    } else {
      add('zenpaid|' + e.name, Object.assign(e, { cli: 'zen', klass: CLASS.CASH, pool: 'zen', exposed: 'opencode/' + id, host: 'remoto', price }));
    }
  }

  // Canale NVIDIA rimosso in v4.26: era una demo, endpoint scaduto.
  // Il gratis e solo Zen free; le righe nvidia/ in inventario vengono ignorate.

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

  function modelIdentity(nome, slug) {
    const s = (String(nome) + ' ' + String(slug)).toLowerCase();
    let lab = 'other';
    if (s.includes('gpt') || s.includes('luna') || s.includes('sol') || s.includes('astra') || s.includes('terra') || s.includes('codex') || /o[1-9]/.test(s)) lab = 'openai';
    else if (s.includes('claude')) lab = 'anthropic';
    else if (s.includes('gemini')) lab = 'google';
    else if (s.includes('deepseek')) lab = 'deepseek';
    else if (s.includes('qwen')) lab = 'qwen';
    else if (s.includes('glm')) lab = 'glm';
    else if (s.includes('kimi')) lab = 'kimi';
    else if (s.includes('ling')) lab = 'ling';
    else if (s.includes('mimo')) lab = 'mimo';
    else if (s.includes('minimax')) lab = 'minimax';
    else if (s.includes('grok')) lab = 'grok';
    else if (s.includes('mistral')) lab = 'mistral';

    let major = null;
    let ver = null;
    let line = 'default';

    if (lab === 'openai') {
      if (s.includes('luna')) line = 'luna';
      else if (s.includes('sol')) line = 'sol';
      else if (s.includes('astra')) line = 'astra';
      else if (s.includes('terra')) line = 'terra';
      else if (s.includes('codex')) line = 'codex';
      else if (s.includes('nano')) line = 'nano';
      else if (s.includes('mini')) line = 'mini';
      else line = 'gpt';
      const m = /gpt[- ]?(\d+(?:\.\d+)?)/i.exec(s) || /(\d+(?:\.\d+)?)/.exec(s);
      ver = m ? parseFloat(m[1]) : (s.includes('o3') ? 6.0 : (s.includes('o1') ? 5.0 : 6.0));
      major = Math.floor(ver);
    } else if (lab === 'anthropic') {
      if (s.includes('opus')) line = 'opus';
      else if (s.includes('sonnet')) line = 'sonnet';
      else if (s.includes('haiku')) line = 'haiku';
      else if (s.includes('fable')) line = 'fable';
      else line = 'claude';
      const m = /(\d+(?:\.\d+)?)/.exec(s.replace(/claude/i, ''));
      ver = m ? parseFloat(m[1]) : 5.0;
      major = Math.floor(ver);
    } else if (lab === 'google') {
      if (s.includes('flash-lite')) line = 'flash-lite';
      else if (s.includes('flash')) line = 'flash';
      else if (s.includes('pro')) line = 'pro';
      else if (s.includes('ultra')) line = 'ultra';
      else line = 'gemini';
      const m = /gemini[- ]?(\d+(?:\.\d+)?)/i.exec(s) || /(\d+(?:\.\d+)?)/.exec(s);
      ver = m ? parseFloat(m[1]) : 3.8;
      major = ver >= 3.8 ? 3.8 : Math.floor(ver * 10) / 10;
    } else if (lab === 'deepseek') {
      if (s.includes('pro')) line = 'pro';
      else if (s.includes('flash')) line = 'flash';
      const m = /v?(\d+(?:\.\d+)?)/i.exec(s);
      ver = m ? parseFloat(m[1]) : 4.0;
      major = Math.floor(ver);
    } else if (lab === 'qwen') {
      if (s.includes('max')) line = 'max';
      else if (s.includes('flash')) line = 'flash';
      else if (s.includes('plus')) line = 'plus';
      else if (s.includes('coder')) line = 'coder';
      const m = /qwen[- ]?(?:coder)?[- ]?(\d+(?:\.\d+)?)/i.exec(s) || /(\d+(?:\.\d+)?)/.exec(s);
      ver = m ? parseFloat(m[1]) : 3.8;
      major = Math.floor(ver * 10) / 10;
    } else if (lab === 'glm') {
      if (s.includes('flash')) line = 'flash';
      const m = /glm[- ]?(\d+(?:\.\d+)?)/i.exec(s) || /(\d+(?:\.\d+)?)/.exec(s);
      ver = m ? parseFloat(m[1]) : 5.3;
      major = Math.floor(ver);
    } else if (lab === 'kimi') {
      if (s.includes('code')) line = 'code';
      const m = /k(\d+(?:\.\d+)?)/i.exec(s) || /(\d+(?:\.\d+)?)/.exec(s);
      ver = m ? parseFloat(m[1]) : 3.0;
      major = Math.floor(ver);
    } else if (lab === 'ling') {
      if (s.includes('flash')) line = 'flash';
      const m = /ling[- ]?(\d+(?:\.\d+)?)/i.exec(s) || /(\d+(?:\.\d+)?)/.exec(s);
      ver = m ? parseFloat(m[1]) : 3.1;
      major = Math.floor(ver * 10) / 10;
    } else if (lab === 'mimo') {
      if (s.includes('flash')) line = 'flash';
      else if (s.includes('pro')) line = 'pro';
      const m = /mimo[- ]?(?:v)?(\d+(?:\.\d+)?)/i.exec(s) || /(\d+(?:\.\d+)?)/.exec(s);
      ver = m ? parseFloat(m[1]) : 2.6;
      major = Math.floor(ver * 10) / 10;
    } else if (lab === 'grok') {
      const m = /grok[- ]?(\d+(?:\.\d+)?)/i.exec(s) || /(\d+(?:\.\d+)?)/.exec(s);
      ver = m ? parseFloat(m[1]) : 4.7;
      major = Math.floor(ver);
    }
    return { lab, line, major, ver };
  }

  // 1. Calcola massima generazione per lab nell intero catalogo
  const maxLabMajor = new Map();
  for (const m of inv.values()) {
    const id = modelIdentity(m.name, m.exposed);
    if (id.major !== null) {
      const cur = maxLabMajor.get(id.lab) || 0;
      if (id.major > cur) maxLabMajor.set(id.lab, id.major);
    }
  }

  // 2. Calcola massima versione per linea di modello
  const maxLineVer = new Map();
  for (const m of inv.values()) {
    const id = modelIdentity(m.name, m.exposed);
    if (id.ver !== null) {
      const k = id.lab + ':' + id.line;
      const cur = maxLineVer.get(k) || 0;
      if (id.ver > cur) maxLineVer.set(k, id.ver);
    }
  }

  // 3. Purga: generazioni lab vecchie, linee superate, modelli ritirati
  for (const [k, m] of [...inv]) {
    const id = modelIdentity(m.name, m.exposed);
    if (id.major !== null && maxLabMajor.has(id.lab) && id.major < maxLabMajor.get(id.lab)) {
      inv.delete(k);
      continue;
    }
    const lineKey = id.lab + ':' + id.line;
    if (id.ver !== null && maxLineVer.has(lineKey) && id.ver < maxLineVer.get(lineKey)) {
      inv.delete(k);
      continue;
    }
    if (isRetiredModel(m.exposed, m.name)) {
      inv.delete(k);
      continue;
    }
  }

  // 4. Deduplica varianti all interno dello stesso pool se rimangono duplicati
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

  // Radar dormiente: nativi di una lane forfait che l'inventario non espone.
  // Il canale Claude nasce solo dall'inventario: un modello Anthropic servito
  // solo da Zen sparirebbe dalla sua casa anche se la lane esiste ed e' solo
  // spenta (abbonamento sospeso) o il probe e' rimasto indietro. Il radar non
  // entra nel routing — resta non proponibile — ma impedisce di dimenticarlo.
  // Codex resta guidato dalla cache live (dinamica, non serve radar); AGY e'
  // un router multivendor e la casa nativa non si deduce dal nome.
  const NATIVE_FLAT = [{ pool: 'claude', cli: 'claude', re: /^claude\s/i }];
  const esposti = new Set([...inv.values()].filter((m) => m.pool === 'claude').map((m) => norm(m.name)));
  // Stesso modello, ordine diverso: lo slug `claude-haiku-4-5` e l'AA
  // `Claude 4.5 Haiku` hanno gli stessi caratteri in ordine diverso, quindi
  // il lookup non li aggancia (resta in unmatched) ma la lane lo espone.
  // Senza questo scarto il radar lo segnalerebbe dormiente per omonimia.
  // Vale solo per il radar, mai per il routing — e solo a parita' di
  // versione, altrimenti un `Sonnet 5.4` nuovo verrebbe coperto da un
  // `Sonnet 4.5` esposto solo perche' anagramma.
  const sortChars = (s) => String(s).split('').sort().join('');
  const slugVer = (slug) => {
    const m = /-(\d+)(?:-(\d+))?$/.exec(String(slug).split('/').pop());
    if (!m) return null;
    return m[2] !== undefined ? parseFloat(m[1] + '.' + m[2]) : parseFloat(m[1]);
  };
  const slugVers = new Map();
  for (const chans of Object.values(hosts)) {
    for (const slug of chans.claude || []) {
      const k = sortChars(norm(String(slug).split('/').pop()));
      const v = slugVer(slug);
      if (v === null) continue;
      if (!slugVers.has(k)) slugVers.set(k, new Set());
      slugVers.get(k).add(v);
    }
  }
  // Max versione esposta per famiglia sulla lane: un dormiente piu vecchio di
  // cio che la lane espone gia non e un buco, e passato. Solo il piu nuovo
  // di cio che manca conta come radar.
  const expMax = new Map();
  for (const m of inv.values()) {
    if (m.pool !== 'claude') continue;
    const { fam, ver } = famiglia(m.name);
    if (ver === null) continue;
    const k = 'claude|' + fam;
    if (!expMax.has(k) || expMax.get(k) < ver) expMax.set(k, ver);
  }
  const dormFam = new Map();
  for (const m of aaModels) {
    const sc = m.evaluations && m.evaluations.artificial_analysis_intelligence_index;
    if (!Number.isFinite(sc)) continue;
    const name = canonical(m.name);
    const nat = NATIVE_FLAT.find((n) => n.re.test(name));
    if (!nat) continue;
    if (esposti.has(norm(name))) continue;
    // Superato sul suo stesso canale: pensionato, non dimenticato.
    if (superati.includes(nat.pool + '/' + name)) continue;
    const { fam, ver } = famiglia(name);
    // Omonimo esposto alla stessa versione: coperto, non dormiente.
    if (ver !== null && slugVers.get(sortChars(norm(name)))?.has(ver)) continue;
    const em = expMax.get(nat.pool + '|' + fam);
    if (ver !== null && em !== undefined && em >= ver) continue;
    const p = dormFam.get(nat.pool + '|' + fam);
    if (!p || ver === null || (p.ver !== null && ver > p.ver)) {
      dormFam.set(nat.pool + '|' + fam, {
        ver, name,
        pool: nat.pool, cli: nat.cli, klass: CLASS.FLAT,
        idx: sc, tps: m.median_output_tokens_per_second || null,
      });
    }
  }
  const dormienti = [...dormFam.values()].sort((a, b) => b.idx - a.idx);

  const all = [...inv.values()];
  const byClass = (k) => all.filter((m) => m.klass === k);

  // Nessun pavimento: ogni ruolo valuta direttamente i modelli sulle metriche
  // del proprio mestiere senza filtri aggregati artificiali.
  const scored = all.filter((m) => m.klass !== CLASS.LOCAL && Number.isFinite(m.idx));
  const catalog = scored.sort((a, b) => b.idx - a.idx);
  const cut = [];

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
  // Include every routing/rendering input: role benchmarks, speed, flat-lane
  // weight, limits and executable slugs can change without changing AA index.
  // Source order is not a data change; normalize keys and inventory arrays.
  function stable(v) {
    if (Array.isArray(v)) return '[' + v.map(stable).sort().join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort()
      .map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
    return JSON.stringify(v);
  }
  const fingerprint = fnv(LOGIC_VERSION + '#' + stable({
    catalog, locals: byClass(CLASS.LOCAL), dormienti,
    hosts: Object.keys(hosts), unmatched: [...new Set(unmatched)], superati,
    aa_total: aaModels.length, zen_total: (zenIds || []).length,
  }));

  return {
    catalog, cut, cash, cashCut, cashBar: CASH_BAR,
    dormienti,
    locals: byClass(CLASS.LOCAL),
    free: catalog.filter((m) => m.klass === CLASS.FREE),
    floor: null,
    floor_model: '(nessuno: valutazione per mestiere)',
    hosts: Object.keys(hosts),
    aa_total: aaModels.length,
    zen_total: (zenIds || []).length,
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
