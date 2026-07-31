// Profili per ruolo: ogni ruolo ha i SUOI test e la SUA politica di costo.
//
// La v3 usava una sola formula pesata per tutti i sette ruoli. Non regge:
// scegliere il modello per un'architettura e scegliere quello per un triage
// ripetitivo sono due decisioni con priorita' diverse, non la stessa decisione
// con pesi leggermente spostati.
//
// Tre politiche di costo, genuinamente diverse fra loro:
//
//   'quality-first' il costo non entra nel calcolo. Per i ruoli dove un errore
//                   costa piu' di qualunque bolletta di token.
//   'ratio'         intelligenza per dollaro. Un rapporto vero, non una somma
//                   pesata: e' la domanda "quanto rendimento mi da' ogni euro".
//   'cheap-first'   prima il costo piu' basso, POI l'intelligenza migliore.
//                   Due chiavi in ordine lessicografico, non una media: su un
//                   lavoro facile e ripetitivo il prezzo decide, e la qualita'
//                   rompe la parita'.
//
// Il prezzo resta un segnale anche a quota pagata: la quota che un vendor
// concede deriva comunque dal costo API che sostiene.

const PROFILES = { QUALITY: 'quality-first', RATIO: 'ratio', CHEAP: 'cheap-first' };

// I test che contano per il ruolo, con il peso relativo dentro il ruolo.
// Composti, non singoli: un ruolo raramente si riduce a una sola prova.
//
// Regola di scelta dei campi: fra due benchmark che misurano la stessa
// capacita', si porta il peso su quello con copertura migliore. Un campo raro
// penalizza in silenzio i modelli che non ce l'hanno -- con terminalbench_hard
// (15/19) al posto di terminalbench_v2_1 (19/19), Claude Opus 5 perdeva
// L-Debug contro un modello che costa il doppio, solo per una misura assente.
const ROLES = [
  {
    id: 'L-Arch',
    purpose: 'Architettura, requisiti, design multi-sistema e documenti lunghi',
    data_class: 'none',
    profile: PROFILES.QUALITY,
    tests: { lcr: 0.5, hle: 0.3, gpqa: 0.2 },
    why: 'ragionamento su contesti lunghi, piu' + ' due prove di ragionamento difficile',
  },
  {
    id: 'L-Build',
    purpose: 'n8n complesso, tool chaining e refactor multi-file',
    data_class: 'none',
    profile: PROFILES.RATIO,
    tests: { tau_banking: 0.45, tau2: 0.35, terminalbench_v2_1: 0.2 },
    why: 'uso agentico di tool su piu' + ' passi, che e\' esattamente il lavoro',
  },
  {
    id: 'L-Code',
    purpose: 'Patch quotidiane, shell e debug medio',
    data_class: 'none',
    profile: PROFILES.RATIO,
    tests: { artificial_analysis_coding_index: 0.7, terminalbench_v2_1: 0.3 },
    why: 'codice piu' + ' capacita\' di lavorare in terminale',
  },
  {
    id: 'L-Sys',
    purpose: 'Oracle, Docker, SSH, incidenti e sistemi',
    data_class: 'infra',
    profile: PROFILES.QUALITY,
    tests: { terminalbench_v2_1: 0.8, terminalbench_hard: 0.2 },
    why: 'un incidente mal gestito costa piu' + ' di qualunque risparmio di token',
  },
  {
    id: 'L-Bulk',
    purpose: 'Estrazioni, triage, scan e trasformazioni ripetitive',
    data_class: 'none',
    profile: PROFILES.CHEAP,
    tests: { ifbench: 1.0 },
    why: 'seguire istruzioni alla lettera su volume: il resto e\' prezzo',
  },
  {
    id: 'Frontend',
    purpose: 'Componenti UI, CSS e frontend',
    data_class: 'none',
    profile: PROFILES.RATIO,
    tests: { artificial_analysis_coding_index: 1.0 },
    why: 'nessun benchmark di frontend esiste: il codice e\' il proxy piu\' onesto',
  },
  {
    id: 'L-Debug',
    purpose: 'Diagnosi: bug difficili, tracce, comportamenti che non tornano',
    data_class: 'none',
    profile: PROFILES.QUALITY,
    tests: { terminalbench_v2_1: 0.35, hle: 0.35, lcr: 0.3 },
    why: 'una diagnosi sbagliata costa ore, non token: prova difficile in '
      + 'terminale, ragionamento duro, e tenere insieme molte evidenze',
  },
  {
    id: 'L-Write',
    purpose: 'Prosa professionale: note, contenuti, candidature, documentazione',
    data_class: 'none',
    profile: PROFILES.RATIO,
    tests: { ifbench: 1.0 },
    why: 'nessun benchmark di scrittura esiste in AA. ifbench misura solo se '
      + 'il brief viene seguito alla lettera, che e\' il minimo, non il gusto. '
      + 'I priori qui vanno riempiti dall\'esperienza d\'uso, non indovinati',
  },
  {
    id: 'Privacy',
    purpose: 'NDA, dati personali, lavoro che non deve uscire dalla macchina',
    data_class: 'personal',
    profile: PROFILES.QUALITY,
    tests: { artificial_analysis_intelligence_index: 1.0 },
    why: 'un modello locale non ha prezzo a token: conta solo quanto e\' capace',
  },
];

// Scala ASSOLUTA, non relativa all'insieme.
//
// Il min-max era sbagliato qui e l'errore si vedeva solo a valle del taglio:
// con sei modelli tutti buoni, forzava il piu' debole a 0 e il migliore a 100,
// trasformando una differenza reale del 15% (Flash 49.9 contro Sol 58.9) in
// 0 contro 100. Il profilo "rapporto" finiva per scegliere il modello piu'
// caro, perche' al piu' economico assegnava merito quasi nullo.
//
// Su scala assoluta i punteggi sono anche stabili nel tempo: non cambiano
// quando un modello entra o esce dal catalogo.
// Deve stare SOPRA il massimo del catalogo, altrimenti i modelli migliori
// sfondano il tetto e diventano indistinguibili: con 60 qui, Claude Opus 5
// (60.7) e Fable 5 (59.9) collassavano entrambi su 100, e i ruoli a qualita'
// eleggevano quello che costava il doppio a parita' apparente. Va alzato
// quando un modello supera questa soglia.
const INDEX_MAX = 80;

// Velocita': un "nice to have", non un criterio. Peso basso e solo sui ruoli
// dove stai davanti allo schermo ad aspettare l'output. Fuori da L-Arch e
// L-Debug, dove il lavoro e' pensare e l'attesa si accetta.
//
// Se non e' misurata NON vale zero: il termine viene escluso e i pesi
// ridistribuiti. Altrimenti si ripete l'errore gia' visto due volte, dove un
// dato assente penalizza il modello invece di non dire nulla.
const W_SPEED = 0.10;
const SPEED_MAX = 250;          // tok/s: il piu' veloce del pool sta a 221
const INTERACTIVE = new Set(['L-Code', 'L-Build', 'L-Sys', 'Frontend', 'L-Bulk', 'L-Write']);

function speedOf(role, model) {
  if (!INTERACTIVE.has(role.id)) return null;
  const tps = Number(model.tps);
  if (!Number.isFinite(tps) || tps <= 0) return null;   // non misurata
  return Math.min(100, (tps / SPEED_MAX) * 100);
}

// Combina i termini sostituendo gli assenti con un valore NEUTRO, non
// scartandoli.
//
// Scartare e ripesare sembrava prudente ma introduce un bias: se il valore
// presente e' sotto la media, non averlo misurato diventa un VANTAGGIO. Si e'
// visto su L-Sys, dove GPT-5.5 (indice 54.8, velocita' non misurata) scalzava
// GPT-5.6 Sol (58.9, velocita' 70 t/s -> 28 su 100) solo perche' Sol si
// portava dietro un termine basso e GPT-5.5 no.
//
// Con la mediana del pool al posto del buco, un dato assente non e' ne'
// penalita' ne' premio: dice soltanto "non lo sappiamo, assumiamo la norma".
function median(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

function blend(parts) {
  let sum = 0, weight = 0;
  for (const [value, w, fallback] of parts) {
    const v = Number.isFinite(value) ? value
      : (Number.isFinite(fallback) ? fallback : null);
    if (v === null) continue;
    sum += v * w; weight += w;
  }
  return weight > 0 ? sum / weight : 0;
}

function absolute(field, raw) {
  if (!Number.isFinite(raw)) return null;
  // Gli *_index vanno 0-60 circa; gli altri benchmark sono frazioni 0-1.
  const pct = field.endsWith('_index') ? (raw / INDEX_MAX) * 100 : raw * 100;
  return Math.max(0, Math.min(100, pct));
}

// Punteggio composito del ruolo: media pesata dei suoi test, ciascuno
// normalizzato sull'insieme dei candidati. I test assenti su un modello non
// lo azzerano: si ripesa su quelli che ha, e si dichiara la copertura.
function roleScore(role, model) {
  let sum = 0, weight = 0;
  const missing = [];
  for (const [field, w] of Object.entries(role.tests)) {
    const v = absolute(field, model.ev ? model.ev[field] : null);
    if (v === null) { missing.push(field); continue; }
    sum += v * w;
    weight += w;
  }
  return {
    value: weight > 0 ? sum / weight : 0,
    coverage: weight,
    missing,
  };
}

// Un modello senza prezzo utile non partecipa a un confronto sul prezzo.
function priceOf(m) {
  return Number.isFinite(m.price) ? m.price : null;
}

function pick(role, candidates) {
  if (!candidates.length) return { picks: [], unassigned: 'nessun candidato eleggibile' };

  const scored = candidates.map(m => ({ model: m, role: roleScore(role, m) }));
  // Mediana della velocita' fra i candidati che ce l'hanno misurata: e' il
  // valore neutro con cui si riempie il buco di chi non ce l'ha.
  const spMedian = median(candidates.map(m => speedOf(role, m)));

  if (role.profile === PROFILES.QUALITY) {
    // Nessun costo. Qualita' generale e affinita' al ruolo, in parti uguali:
    // l'indice dice quanto e' capace, il composito quanto lo e' su questo lavoro.
    for (const s of scored) {
      const q = absolute('artificial_analysis_intelligence_index', s.model.idx);
      const sp = speedOf(role, s.model);
      s.total = blend([[q, 0.45], [s.role.value, 0.45], [sp, W_SPEED, spMedian]]);
      s.explain = `qualita' ${q.toFixed(0)} + ruolo ${s.role.value.toFixed(0)}`
        + (sp === null ? ', velocita non misurata' : ` + velocita ${sp.toFixed(0)}`)
        + ', costo escluso';
    }
    scored.sort((a, b) => b.total - a.total);

  } else if (role.profile === PROFILES.RATIO) {
    // Rendimento per dollaro. Il prezzo entra come divisore, non come termine
    // additivo, perche' la domanda e' un rapporto. Il floor evita che un
    // modello a costo zero renda il rapporto infinito e vinca per definizione.
    for (const s of scored) {
      const q = absolute('artificial_analysis_intelligence_index', s.model.idx);
      const sp = speedOf(role, s.model);
      const merit = blend([[q, 0.45], [s.role.value, 0.45], [sp, W_SPEED, spMedian]]);
      const p = Math.max(priceOf(s.model) ?? 99, 0.05);
      s.total = merit / Math.log10(1 + p * 20);
      s.explain = `merito ${merit.toFixed(0)} / costo $${p} -> ${s.total.toFixed(1)} per dollaro`;
    }
    scored.sort((a, b) => b.total - a.total);

  } else {
    // Prima il prezzo, poi la qualita'. Ordinamento a due chiavi: la seconda
    // interviene solo a parita' di prima, come chiesto.
    for (const s of scored) {
      const sp = speedOf(role, s.model);
      s.total = blend([[s.role.value, 0.9], [sp, W_SPEED, spMedian]]);
      s.explain = `costo $${priceOf(s.model)} (chiave 1), ruolo+velocita ${s.total.toFixed(0)} (chiave 2)`;
    }
    scored.sort((a, b) => {
      const pa = priceOf(a.model) ?? 99, pb = priceOf(b.model) ?? 99;
      if (pa !== pb) return pa - pb;
      return b.total - a.total;
    });
  }

  // Primario piu' due fallback, preferendo CLI diverse: se salta un canale
  // non deve saltare l'intera rotta.
  const picks = [];
  for (const s of scored) {
    if (!picks.length) { picks.push(s); continue; }
    if (picks.length < 3 && !picks.some(p => p.model.cli === s.model.cli)) picks.push(s);
    if (picks.length === 3) break;
  }
  for (const s of scored) {
    if (picks.length === 3) break;
    if (!picks.includes(s)) picks.push(s);
  }
  return { picks };
}

function eligible(role, inventory) {
  if (role.data_class === 'personal') return inventory.filter(m => m.cli === 'local');
  return inventory.slice();
}

function route(inventory) {
  return ROLES.map(role => {
    const cands = eligible(role, inventory);
    if (role.data_class === 'personal' && !cands.length) {
      return {
        role, eligible: 0, picks: [],
        unassigned: 'nessun modello locale su questo host: il ruolo resta non '
          + 'assegnato invece di ricadere su un cloud',
      };
    }
    return { role, eligible: cands.length, ...pick(role, cands) };
  });
}

module.exports = { route, ROLES, PROFILES };
