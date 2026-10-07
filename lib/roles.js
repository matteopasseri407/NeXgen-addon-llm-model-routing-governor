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
// FASE 2 — routing
const P = { Q: 'quality-first', R: 'ratio', C: 'cheap-first' };
const ROLES = [
  { id: 'L-Arch', data: 'none', profile: P.Q, tests: { lcr: 0.5, hle: 0.3, gpqa: 0.2 }, purpose: 'Architettura, requisiti, design multi-sistema, documenti lunghi' },
  { id: 'L-Debug', data: 'none', profile: P.Q, tests: { terminalbench_v4_0: 0.35, hle: 0.35, lcr: 0.3 }, purpose: 'Diagnosi: bug difficili, tracce, comportamenti che non tornano' },
  // v4.24: terminalbench_v4_0 e la versione corrente del bench (copertura 88% contro 73% della v2_1 sul catalogo live 2026-10-03). Stessa capacita, misura piu nuova.
  { id: 'L-Sys', data: 'infra', profile: P.Q, tests: { terminalbench_v4_0: 1 }, purpose: 'Infrastruttura, Docker, SSH, incidenti' },
  { id: 'L-Code', data: 'none', profile: P.R, tests: { artificial_analysis_coding_index: 0.7, terminalbench_v4_0: 0.3 }, purpose: 'Patch quotidiane, shell, debug medio' },
  { id: 'L-Build', data: 'none', profile: P.R, tests: { tau_banking: 0.4, artificial_analysis_coding_index: 0.35, terminalbench_v4_0: 0.25 }, purpose: 'n8n complesso, tool chaining, refactor multi-file' },
  { id: 'Frontend', data: 'none', profile: P.R, tests: { artificial_analysis_coding_index: 1 }, purpose: 'Componenti UI, CSS' },
  // Due correzioni insieme, e vale la pena dire perche'.
  // PROFILO: era `ratio`, cioe' merito diviso peso, e questo lo rendeva un
  // doppione di L-Bulk -- stesso test, e tutti e due finivano per pescare il
  // piu' economico. Ma la prosa la si rilegge, e venti punti di distacco sulla
  // scrittura non valgono due dollari di listino risparmiati. Qui si prende
  // chi scrive meglio; il risparmio si fa su L-Bulk, che resta cheap-first.
  // TEST: `ifbench` da solo misura l'obbedienza alle istruzioni, non la prosa
  // -- AA non pubblica un benchmark di scrittura -- ed e' misurato su meno di
  // meta' del catalogo, quindi il ruolo restava spesso senza un solo dato.
  // `lcr` (ragionamento su contesto lungo) ha copertura piena e coglie la parte
  // che conta davvero qui: tenere insieme un testo lungo senza perdere il filo.
  // Council v2 2026-10-03 (deepseek, single seat: sol+gemini abstained on quota):
  // ifbench 34% cannot lead at .6 — same coverage rule that dropped tau2.
  // lcr (98.5%) leads, ifbench stays as the instruction signal.
  { id: 'L-Write', data: 'none', profile: P.Q, tests: { lcr: 0.6, ifbench: 0.4 }, purpose: 'Prosa: note, contenuti, candidature, documentazione, traduzioni lunghe' },
  { id: 'L-Think', data: 'none', profile: P.Q, tests: { hle: 0.35, artificial_analysis_coding_index: 0.25, lcr: 0.25, gpqa: 0.15 }, purpose: 'Ragionamento pesante: brainstorming, review di bug e piani, decisioni difficili' },
  // Council 2026-10-03 (sol+gemini+deepseek, 2/3 per il cambio, deepseek: bloccante):
  // ifbench da solo lasciava meta catalogo al fallback cieco. lcr (copertura
  // piena) misura recall/estrazione su contesti lunghi: il cuore di
  // estrazione/triage/scan. A ifbench assente la rinormalizzazione da il 100%
  // a lcr invece di degradare sull'aggregato.
  { id: 'L-Bulk', data: 'none', profile: P.C, tests: { lcr: 0.6, ifbench: 0.4 }, purpose: 'Estrazioni, triage, scan, trasformazioni ripetitive' },
  { id: 'Privacy', data: 'personal', profile: P.Q, tests: { artificial_analysis_intelligence_index: 1 }, purpose: 'NDA, dati personali, lavoro che non deve uscire dalla macchina' },
];
const PRIOR = { Frontend: [[/GLM/i, 50], [/Terra/i, 36], [/Opus/i, 30]], 'L-Write': [] };
// Modelli con benchmark sintetici gonfiati e fragilita' critica accertata sul campo.
// L'evidenza empirica batte il benchmark sintetico sui compiti di ragionamento.
const EMPIRICAL_PENALTY = {
  'L-Arch': { 'GPT-6 Astra': 0.85 },
  'L-Debug': { 'GPT-6 Astra': 0.85 },
  'L-Sys': { 'GPT-6 Astra': 0.85 },
  'L-Write': { 'GPT-6 Astra': 0.85 },
  // L-Think e' giudizio puro (brainstorming, review piani): la stessa
  // inaffidabilita' accertata sul campo vale qui piu' che altrove.
  'L-Think': { 'GPT-6 Astra': 0.85 },
};
const INDEX_MAX = 80, SPEED_MAX = 250, W_SPEED = 0.1;
const INTERACTIVE = new Set(['L-Code', 'L-Build', 'L-Sys', 'Frontend', 'L-Bulk', 'L-Write', 'L-Think']);

function abs(f, raw) {
  if (!Number.isFinite(raw)) return null;
  const pct = f.endsWith('_index') ? (raw / INDEX_MAX) * 100 : raw * 100;
  return Math.max(0, Math.min(100, pct));
}
function median(vals) {
  const v = vals.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
function blend(parts) {
  let s = 0, w = 0;
  for (const [v, weight, fb] of parts) {
    const x = Number.isFinite(v) ? v : (Number.isFinite(fb) ? fb : null);
    if (x === null) continue;
    s += x * weight; w += weight;
  }
  return w > 0 ? s / w : 0;
}
// PESO, non costo. Quanto quel modello ti consuma, su qualunque canale:
//   quota  -> il prezzo sul canale, che e' esattamente il consumo del budget
//   flat   -> il listino del vendor, come misura di QUANTO PESA il modello.
//             Su un forfait non paghi il token, ma la finestra d'uso e' finita
//             e un modello grosso te la mangia in fretta. Dire "il forfait non
//             costa niente, quindi prendi il migliore" e' l'errore che aveva
//             reso decorativi i profili ratio e cheap-first: L-Bulk finiva a
//             bruciare il modello di punta su un triage di estrazioni.
//   free/cash -> il prezzo vero, che li' e' anche cassa.
// Ridotto tutto alla stessa scala in dollari, i punteggi tornano confrontabili
// fra canali: era l'altro motivo per cui prima servivano due passaggi.
function peso(m) {
  const v = m.klass === CLASS.FLAT ? m.aaPrice : m.price;
  return Number.isFinite(v) ? v : 99;
}
function prior(id, m) { for (const [re, val] of PRIOR[id] || []) if (re.test(m.name)) return val; return null; }
function roleScore(role, m) {
  let s = 0, w = 0; const missing = [];
  for (const [f, weight] of Object.entries(role.tests)) {
    const v = abs(f, m.ev ? m.ev[f] : null);
    if (v === null) { missing.push(f); continue; }
    s += v * weight; w += weight;
  }
  // Nessun test del ruolo misurato: il punteggio e' IGNOTO, non zero. Prima
  // tornava 0, e quello zero entrava in uno slot che pesa il 45% del merito:
  // un modello mai misurato veniva bocciato invece che semplicemente giudicato
  // sul generale. Su L-Write nessuno dei campioni aveva ifbench, quindi il
  // ruolo classificava quattro zeri e ordinava di fatto per indice aggregato.
  // Tornando null, `blend` lascia cadere il termine e rinormalizza. E' lo
  // stesso ragionamento del controllo `cieco` sullo slot gratis, che qui
  // mancava. Il prior resta perche' e' un dato d'uso: vale piu' del silenzio.
  if (w === 0) return { value: prior(role.id, m), missing };
  return { value: s / w, missing };
}
function speed(role, m) {
  if (!INTERACTIVE.has(role.id)) return null;
  const t = Number(m.tps);
  return Number.isFinite(t) && t > 0 ? Math.min(100, (t / SPEED_MAX) * 100) : null;
}

function routeRoles(d) {
  const out = [];
  const scala = (d.catalog || []).filter((m) => m.klass === CLASS.FLAT || m.klass === CLASS.QUOTA);
  const cashPool = d.cash || [];

  // Nessun pavimento a monte: tutti i modelli a catalogo partecipano direttamente
  // alla valutazione per ciascun ruolo sui rispettivi benchmark di mestiere.

  for (const role of ROLES) {
    if (role.data === 'personal') {
      // Dati personali: SOLO locale, nessun ripiego cloud, per nessun motivo.
      const loc = d.locals || [];
      if (!loc.length) {
        out.push({
          role, eligible: 0, picks: [], pools: [], free: null, cash: null,
          unassigned: 'nessun modello locale sugli host che hanno pubblicato: il ruolo resta non assegnato invece di ricadere su un cloud',
        });
        continue;
      }
      // I locali non stanno in AA e restano senza punteggio: ordinarli per
      // merito sarebbe inventare un dato. Si elencano per host, e la scelta
      // fra le varianti di contesto resta d'uso, non da classifica.
      const ord = loc.slice().sort((a, b) => String(a.host + a.name).localeCompare(String(b.host + b.name)));
      out.push({
        role, eligible: ord.length, pools: ['local'], pool_warning: null, free: null, cash: null,
        unassigned: null,
        full: { local: ord.map((m) => ({ name: m.name, exposed: m.exposed,
          klass: CLASS.LOCAL, merit: null, price: 0, missing: [],
          note: 'solo su ' + m.host + ', fuori classifica' })) },
        picks: ord.slice(0, 3).map((m, i) => ({
          // Stesse etichette degli altri ruoli: il render conta i rimpiazzi a
          // partire da 'prescelto', e un'etichetta diversa qui gli faceva
          // proseguire la numerazione del ruolo precedente.
          slot: i === 0 ? 'prescelto' : 'rimpiazzo ' + i,
          name: m.name, cli: 'local', pool: 'local', klass: CLASS.LOCAL, exposed: m.exposed,
          price: 0, idx: null, tps: null, ctx: null, score: null, missing: [],
          why: 'solo su `' + m.host + '`, fuori classifica: qui conta che il dato non esca, non il punteggio',
        })),
      });
      continue;
    }

    const pool13 = scala;
    const freePool = d.free || [];
    const spMed = median(pool13.map((m) => speed(role, m)));
    const merit = (m) => {
      const rs = roleScore(role, m);
      const q = abs('artificial_analysis_intelligence_index', m.idx);
      const sp = speed(role, m);
      // L'indice aggregato NON decide piu' alla pari (0.45/0.45): e' una media
      // su test che col mestiere non c'entrano, e dimezzava il mestiere in
      // ogni ruolo. I test di ruolo pesano 0.9; q resta solo come fallback
      // sui buchi (terzo elemento di blend), come gia' fa spMed per la velocita'.
      let val = blend([[rs.value, 0.9, q], [sp, W_SPEED, spMed]]);
      const pen = (EMPIRICAL_PENALTY[role.id] && EMPIRICAL_PENALTY[role.id][m.name]) || 1.0;
      val *= pen;
      return { rs, value: val, q, penalty: pen < 1 ? pen : null };
    };

    // UN CAMPIONE PER CANALE, SEMPRE. Non i tre migliori in assoluto: la lista
    // e' il prescelto piu' un rimpiazzo per ogni altro canale. Cosi' un canale
    // non sparisce mai dalla proposta solo perche' i suoi modelli sono piu'
    // deboli -- ed e' anche cio' che rende inutile tracciare gli abbonamenti:
    // se un canale non e' pagato il Council non lo avvia e scende al prossimo.
    //
    // Dentro il canale vale la SUA economia; fra canali si confronta il merito,
    // che e' l'unica scala comune. Confrontare un rapporto (che sfonda 100) con
    // un merito (che si ferma a 100) faceva vincere sempre la quota sul
    // forfait, cioe' il contrario del vero: il forfait non consuma niente.
    const byPool = new Map();
    for (const m of pool13) {
      if (!byPool.has(m.pool)) byPool.set(m.pool, []);
      byPool.get(m.pool).push(m);
    }
    const champions = [];
    const full = {};
    for (const [pool, members] of byPool) {
      const scored = members.map((m) => {
        const mer = merit(m);
        const p = Math.max(peso(m), 0.05);
        let rank, why;
        const penTag = mer.penalty ? ' (penalita empirica -' + Math.round((1 - mer.penalty) * 100) + '%)' : '';
        if (role.profile === P.Q) {
          // Il ruolo vale il consumo: si prende il migliore e basta.
          rank = mer.value;
          why = 'merito ' + mer.value.toFixed(0) + penTag + (m.klass === CLASS.FLAT ? ', forfait' : ', quota bruciata volentieri');
        } else if (role.profile === P.R) {
          rank = mer.value / Math.log10(1 + p * 20);
          why = 'merito ' + mer.value.toFixed(0) + penTag + ' per peso ' + p + ' = ' + rank.toFixed(0);
        } else {
          // Il piu' leggero, poi il migliore fra i pari peso.
          rank = -p;
          why = 'il piu leggero del canale (peso ' + p + '), merito ' + mer.value.toFixed(0) + penTag;
        }
        return { m, rs: mer.rs, merit: mer.value, rank, why, pool };
      }).sort((a, b) => (b.rank - a.rank) || (b.merit - a.merit));
      if (scored.length) champions.push(scored[0]);
      full[pool] = scored.map((s) => ({
        name: s.m.name, exposed: s.m.exposed, klass: s.m.klass,
        merit: Number(s.merit.toFixed(1)), price: s.m.klass === 'flat' ? 'forfait' : s.m.price,
        missing: s.rs.missing,
      }));
    }
    // Go e Diretto non sono mai prima dei flat puri americani, anche se il rapporto e' ottimo.
    // I forfait veri (claude, agy, codex) hanno priorita' di tier su Go, che e'
    // mezzo a consumo: si ordina prima per classe, poi per profilo.
    // Go e Diretto restano dietro ai flat, mai prescelti davanti a loro.
    champions.sort((a, b) => {
      const prio = { [CLASS.FLAT]: 0, [CLASS.QUOTA]: 1 };
      const pa = prio[a.m.klass] ?? 2, pb = prio[b.m.klass] ?? 2;
      if (pa !== pb) return pa - pb;
      return (b.rank - a.rank) || (b.merit - a.merit);
    });
    const picks = champions;
    const pools = [...new Set(picks.map((p) => p.m.pool))];
    const top = picks[0] ? picks[0].merit : 0;

    // Non si va a fare la spesa col TIR. Sui compiti facili, un modello che
    // pesa piu' di dieci volte l'opzione piu' leggera disponibile e' fuori
    // misura: si dichiara invece di proporlo in silenzio, cosi' quel canale
    // resta nella scala (serve se gli altri non rispondono) ma si sa che li'
    // stai usando un mezzo sbagliato.
    // La soglia e' RELATIVA al piu' leggero del giro, non una cifra scelta a
    // mano: si ritara da se' quando il catalogo cambia.
    if (role.profile === P.C && picks.length) {
      const minPeso = Math.min(...picks.map((p) => Math.max(peso(p.m), 0.05)));
      for (const p of picks) p.sovradimensionato = Math.max(peso(p.m), 0.05) > minPeso * 10;
    }

    // Slot 4 — gratis. Escluso dai ruoli che toccano dati non banali: il
    // gratis paga col training sui tuoi contenuti, e quello su infra non passa.
    let free = null;
    if (role.data === 'none' && freePool.length) {
      const fs = freePool.map((m) => ({ m, merit: merit(m) })).sort((a, b) => b.merit.value - a.merit.value)[0];
      if (fs) {
        // Se i test del ruolo non sono misurati su questo modello, il punteggio
        // di ruolo ripiega su zero e il divario risulta enorme per ASSENZA di
        // dato, non per scarsa qualita'. Dirlo invece di stampare una
        // percentuale che sembra un giudizio.
        const cieco = fs.merit.rs.missing.length >= Object.keys(role.tests).length;
        const gap = top > 0 ? (fs.merit.value / top) : 0;
        free = {
          name: fs.m.name, exposed: fs.m.exposed, ctx: fs.m.ctx, out: fs.m.out,
          // Unico gratis rimasto: Zen free (versione depotenziata, coda che
          // sfratta, dato nel training). Il ramo NVIDIA e stato rimosso con
          // il canale in v4.26.
          pool: fs.m.pool,
          idx: fs.m.idx, score: Number(fs.merit.value.toFixed(2)),
          missing: fs.merit.rs.missing,
          delegabile: cieco ? null : gap >= 0.9,
          gap: cieco ? null : Number((gap * 100).toFixed(0)),
        };
      }
    }

    // Slot 5 — Zen a pagamento. Gia' ristretto a frontiera + sbarra a monte:
    // qui si sceglie il miglior rapporto, che e' l'unica corsia dove il
    // rapporto significa davvero qualcosa perche' paghi ogni token.
    let cash = null;
    const cashRank = (m) => {
      const mer = merit(m);
      return { m, merit: mer, ratio: mer.value / Math.log10(1 + Math.max(m.price, 0.05) * 20) };
    };
    if (cashPool.length) {
      const cs = cashPool.map(cashRank).sort((a, b) => b.ratio - a.ratio)[0];
      if (cs) {
        cash = {
          name: cs.m.name, exposed: cs.m.exposed, price: cs.m.price, ctx: cs.m.ctx,
          pool: cs.m.pool,
          idx: cs.m.idx, score: Number(cs.merit.value.toFixed(2)),
          missing: cs.merit.rs.missing,
          // Stesso modello del primario: copre la quota esaurita alla
          // perfezione, ma se e' il fornitore ad avere il disservizio cadono
          // insieme. Si dichiara invece di far finta che sia una seconda strada.
          stesso_del_primario: !!(picks[0] && picks[0].m.name === cs.m.name),
        };
      }
    }

    // The appendix declares availability, not eligibility for automatic routing.
    // Keep every free/cash model, including cash outside the emergency frontier.
    full['zen-free'] = freePool.map((m) => ({ m, mer: merit(m) }))
      .sort((a, b) => b.mer.value - a.mer.value).map(({ m, mer }) => ({
        name: m.name, exposed: m.exposed, klass: m.klass,
        merit: Number(mer.value.toFixed(1)), price: m.price, missing: mer.rs.missing,
        note: role.data === 'none' ? '' : 'escluso dal routing: dati ' + role.data,
      }));
    full.zen = (d.catalog || []).filter((m) => m.klass === CLASS.CASH)
      .map(cashRank).sort((a, b) => b.ratio - a.ratio).map(({ m, merit: mer }) => ({
        name: m.name, exposed: m.exposed, klass: m.klass,
        merit: Number(mer.value.toFixed(1)), price: m.price, missing: mer.rs.missing,
        note: m.price > d.cashBar ? 'oltre la sbarra emergenza: solo manuale'
          : (!cashPool.includes(m) ? 'fuori frontiera emergenza: solo manuale' : ''),
      }));

    out.push({
      role, eligible: pool13.length, pools, full,
      pool_warning: pools.length < 3 ? 'solo ' + pools.length + ' pool distinti' : null,
      picks: picks.map((p, i) => ({
        slot: i === 0 ? 'prescelto' : 'rimpiazzo ' + i,
        name: p.m.name, cli: p.m.cli, pool: p.m.pool, klass: p.m.klass, exposed: p.m.exposed,
        price: money(p.m.price), idx: p.m.idx, tps: p.m.tps, ctx: p.m.ctx,
        score: Number(p.merit.toFixed(2)), why: p.why, missing: p.rs.missing,
        sotto_pavimento: false,
        ripescato: false,
        sovradimensionato: !!p.sovradimensionato,
        peso: money(peso(p.m)),
      })),
      free, cash,
    });
  }
  return out;
}


const d = $input.first().json;
return [{ json: Object.assign({}, d, { routing: routeRoles(d) }) }];
