// Estratto dal workflow (nodo `Route roles`) — versione esattamente deployata.
// Fonte unica: workflows/model-routing-governor-demo.json.
// Profili per ruolo, classi di canale (flat/quota/free/cash/local) e tier.
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
// FASE 2 — routing
const P = { Q: 'quality-first', R: 'ratio', C: 'cheap-first' };
const ROLES = [
  { id: 'L-Arch', data: 'none', profile: P.Q, tests: { lcr: 0.5, hle: 0.3, gpqa: 0.2 }, purpose: 'Architettura, requisiti, design multi-sistema, documenti lunghi' },
  { id: 'L-Debug', data: 'none', profile: P.Q, tests: { terminalbench_v2_1: 0.35, hle: 0.35, lcr: 0.3 }, purpose: 'Diagnosi: bug difficili, tracce, comportamenti che non tornano' },
  { id: 'L-Sys', data: 'infra', profile: P.Q, tests: { terminalbench_v2_1: 0.8, terminalbench_hard: 0.2 }, purpose: 'Infrastruttura, Docker, SSH, incidenti' },
  { id: 'L-Code', data: 'none', profile: P.R, tests: { artificial_analysis_coding_index: 0.7, terminalbench_v2_1: 0.3 }, purpose: 'Patch quotidiane, shell, debug medio' },
  { id: 'L-Build', data: 'none', profile: P.R, tests: { tau_banking: 0.45, tau2: 0.35, terminalbench_v2_1: 0.2 }, purpose: 'n8n complesso, tool chaining, refactor multi-file' },
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
  { id: 'L-Write', data: 'none', profile: P.Q, tests: { ifbench: 0.6, lcr: 0.4 }, purpose: 'Prosa: note, contenuti, candidature, documentazione, traduzioni lunghe' },
  { id: 'L-Bulk', data: 'none', profile: P.C, tests: { ifbench: 1 }, purpose: 'Estrazioni, triage, scan, trasformazioni ripetitive' },
  { id: 'Privacy', data: 'personal', profile: P.Q, tests: { artificial_analysis_intelligence_index: 1 }, purpose: 'NDA, dati personali, lavoro che non deve uscire dalla macchina' },
];
const PRIOR = { Frontend: [[/GLM/i, 50], [/Terra/i, 36], [/Opus/i, 30]], 'L-Write': [] };
const INDEX_MAX = 80, SPEED_MAX = 250, W_SPEED = 0.1;
const INTERACTIVE = new Set(['L-Code', 'L-Build', 'L-Sys', 'Frontend', 'L-Bulk', 'L-Write']);

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

  // RIPESCAGGIO PER RUOLO. Il pavimento e' una MEDIA, e una media non sa niente
  // del mestiere: sui test che contano per la scrittura i primi cinque del
  // catalogo stanno tutti sotto il pavimento, perche' seguire istruzioni alla
  // lettera e essere intelligenti in generale sono cose diverse -- anzi, li'
  // dentro sono quasi anticorrelate. Il filtro toglieva quindi esattamente i
  // modelli che portano il dato del ruolo, e lasciava in gara solo quelli mai
  // misurati: il ruolo finiva per ordinare per indice aggregato, cioe' per la
  // cosa che il pavimento aveva gia' guardato.
  // Ogni ruolo si ripiglia allora da sotto chi e' misurato sui SUOI test e li'
  // non fa peggio del modello di riferimento. Se il riferimento su quei test
  // non e' misurato -- succede: DeepSeek V4 Flash non ha ifbench -- resta
  // l'unica condizione sensata, cioe' avere il dato. Non si boccia nessuno nel
  // confronto con un modello che nessuno ha mai misurato.
  const rif = (d.catalog || []).find((m) => m.name === d.floor_model) || null;
  const KL_SCALA = new Set([CLASS.FLAT, CLASS.QUOTA]);
  const KL_FREE = new Set([CLASS.FREE]);
  const ripesca = (role, klassi) => {
    const soglia = rif ? roleScore(role, rif).value : null;
    return (d.cut || []).filter((m) => {
      if (!klassi.has(m.klass)) return false;
      const v = roleScore(role, m).value;
      return v !== null && (soglia === null || v >= soglia);
    });
  };

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

    // Il ripescaggio dipende dal ruolo, quindi il pool si ricompone ogni giro:
    // un modello sotto il pavimento entra dove il suo mestiere conta, e resta
    // fuori dagli altri.
    const ripescati = ripesca(role, KL_SCALA);
    const ripSet = new Set(ripescati);
    const pool13 = scala.concat(ripescati);
    const freePool = (d.free || []).concat(ripesca(role, KL_FREE));
    const spMed = median(pool13.map((m) => speed(role, m)));
    const merit = (m) => {
      const rs = roleScore(role, m);
      const q = abs('artificial_analysis_intelligence_index', m.idx);
      const sp = speed(role, m);
      return { rs, value: blend([[q, 0.45], [rs.value, 0.45], [sp, W_SPEED, spMed]]), q };
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
    const sottoPavimento = (d.cut || []).filter((m) => m.klass === CLASS.FLAT || m.klass === CLASS.QUOTA);
    const byPool = new Map();
    for (const m of pool13) {
      if (!byPool.has(m.pool)) byPool.set(m.pool, []);
      byPool.get(m.pool).push(m);
    }
    // Un canale che non ha NIENTE sopra il pavimento entra col suo migliore
    // comunque, marcato. Il pavimento dice "non vale la pena se hai di meglio
    // a due lire", ma quel ragionamento regge finche' il meglio c'e' davvero:
    // il giorno che gli altri canali scadono, questo e' cio' che resta.
    for (const m of sottoPavimento) {
      if (byPool.has(m.pool)) continue;
      if (!byPool.has(m.pool)) byPool.set(m.pool, []);
      byPool.get(m.pool).push(m);
    }
    const champions = [];
    for (const [pool, members] of byPool) {
      const scored = members.map((m) => {
        const mer = merit(m);
        const p = Math.max(peso(m), 0.05);
        let rank, why;
        if (role.profile === P.Q) {
          // Il ruolo vale il consumo: si prende il migliore e basta.
          rank = mer.value;
          why = 'merito ' + mer.value.toFixed(0) + (m.klass === CLASS.FLAT ? ', forfait' : ', quota bruciata volentieri');
        } else if (role.profile === P.R) {
          rank = mer.value / Math.log10(1 + p * 20);
          why = 'merito ' + mer.value.toFixed(0) + ' per peso ' + p + ' = ' + rank.toFixed(0);
        } else {
          // Il piu' leggero, poi il migliore fra i pari peso.
          rank = -p;
          why = 'il piu leggero del canale (peso ' + p + '), merito ' + mer.value.toFixed(0);
        }
        return { m, rs: mer.rs, merit: mer.value, rank, why, pool };
      }).sort((a, b) => (b.rank - a.rank) || (b.merit - a.merit));
      if (scored.length) champions.push(scored[0]);
    }
    // Go non e' mai prima dei flat puri americani, anche se il rapporto e' ottimo.
    // I forfait veri (claude, agy, codex) hanno priorita' di tier su Go, che e'
    // mezzo a consumo: si ordina prima per classe, poi per profilo.
    // Go resta quarto forfait, mai prescelto davanti ai flat.
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
          // Il pool decide la postilla: lo Zen free e NVIDIA sono gratis per
          // ragioni diverse e si rompono in modi diversi. Dirlo uguale sarebbe
          // una mezza verita' su entrambi.
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
    if (cashPool.length) {
      const cs = cashPool.map((m) => {
        const mer = merit(m);
        const p = Math.max(m.price, 0.05);
        return { m, merit: mer, ratio: mer.value / Math.log10(1 + p * 20) };
      }).sort((a, b) => b.ratio - a.ratio)[0];
      if (cs) {
        cash = {
          name: cs.m.name, exposed: cs.m.exposed, price: cs.m.price, ctx: cs.m.ctx,
          idx: cs.m.idx, score: Number(cs.merit.value.toFixed(2)),
          missing: cs.merit.rs.missing,
          // Stesso modello del primario: copre la quota esaurita alla
          // perfezione, ma se e' il fornitore ad avere il disservizio cadono
          // insieme. Si dichiara invece di far finta che sia una seconda strada.
          stesso_del_primario: !!(picks[0] && picks[0].m.name === cs.m.name),
        };
      }
    }

    out.push({
      role, eligible: pool13.length, pools,
      pool_warning: pools.length < 3 ? 'solo ' + pools.length + ' pool distinti' : null,
      picks: picks.map((p, i) => ({
        slot: i === 0 ? 'prescelto' : 'rimpiazzo ' + i,
        name: p.m.name, cli: p.m.cli, pool: p.m.pool, klass: p.m.klass, exposed: p.m.exposed,
        price: money(p.m.price), idx: p.m.idx, tps: p.m.tps, ctx: p.m.ctx,
        score: Number(p.merit.toFixed(2)), why: p.why, missing: p.rs.missing,
        sotto_pavimento: Number.isFinite(p.m.idx) && Number.isFinite(d.floor) && p.m.idx < d.floor,
        // Due modi diversi di stare sotto il pavimento, e vanno detti diversi:
        // ripescato = ha il dato del ruolo e li' regge, quindi ci sta per
        // merito; l'altro caso e' un canale che sopra il pavimento non ha
        // proprio niente, e allora si prende il suo meglio per non perderlo.
        ripescato: ripSet.has(p.m),
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

