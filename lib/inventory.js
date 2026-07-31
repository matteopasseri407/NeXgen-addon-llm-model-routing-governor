// Nuovo "Normalize verified catalog" per il Governor, su API invece che scraping.
//
// Cambia la fonte, non il contratto: produce esattamente i campi che
// "Prepare constrained routing decision" si aspetta.
//
// Tre correzioni rispetto alla v2:
//  1. canonicalName conosce il vocabolario di suffissi dell'API
//     ("(Adaptive Reasoning, Max Effort)", "(Non-reasoning)", ...), non solo
//     quello del sito ("(max)", "(xhigh)"). Era la ragione per cui
//     DeepSeek V4 Pro/Flash non matchavano piu' nulla.
//  2. La disponibilita' viene da una mappa CLI-per-CLI presa dai CLI reali,
//     non da sei regex scritte a mano che citavano Claude Opus 4.8, un
//     modello che non e' piu' nel catalogo.
//  3. Il context window non esiste nell'API: viene dichiarato assente
//     invece di essere silenziosamente 0.

const EFFORT_SUFFIX = /\s+\((?:adaptive\s+)?(?:non-)?reasoning(?:,\s*[a-z]+\s+effort)?(?:,\s*[^)]*fallback)?\)$/i;
const LEVEL_SUFFIX = /\s+\((?:max|xhigh|high|medium|low|minimal|with fallback|preview)\)$/i;
const DATE_SUFFIX = /\s+\((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s*'?\d{2}\)$/i;
// " Preview" senza parentesi: l'API lo usa nudo ("Gemini 3.1 Pro Preview").
const BARE_SUFFIX = /\s+Preview$/i;

function canonicalName(value) {
  let out = String(value || '').trim();
  for (let i = 0; i < 4; i += 1) {
    const before = out;
    out = out.replace(EFFORT_SUFFIX, '').replace(LEVEL_SUFFIX, '')
             .replace(DATE_SUFFIX, '').replace(BARE_SUFFIX, '').trim();
    if (out === before) break;
  }
  return out;
}

function slug(value) {
  return String(value || '').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Snapshot della disponibilita' reale, letta dai CLI il 2026-07-31.
// privacy: 'western' | 'restricted' | 'local'.
// Va rinfrescata da un adattatore locale: e' verita' di ambiente, non di catalogo.
const SEATS = [
  // Antigravity -- da `agy models`
  { match: /^Gemini 3\.6 Flash$/i,   cli: 'Antigravity', pool: 'Google',   privacy: 'western' },
  { match: /^Gemini 3\.5 Flash$/i,   cli: 'Antigravity', pool: 'Google',   privacy: 'western' },
  { match: /^Gemini 3\.1 Pro$/i,     cli: 'Antigravity', pool: 'Google',   privacy: 'western' },
  { match: /^Claude Sonnet 4\.6$/i,  cli: 'Antigravity', pool: 'Anthropic', privacy: 'western' },
  { match: /^Claude Opus 4\.6$/i,    cli: 'Antigravity', pool: 'Anthropic', privacy: 'western' },
  { match: /^gpt-oss-120b$/i,        cli: 'Antigravity', pool: 'OpenAI',   privacy: 'western' },
  // OpenCode Go -- da `opencode models`
  { match: /^DeepSeek V4 Pro$/i,     cli: 'OpenCode Go', pool: 'DeepSeek',  privacy: 'restricted' },
  { match: /^DeepSeek V4 Flash$/i,   cli: 'OpenCode Go', pool: 'DeepSeek',  privacy: 'restricted' },
  { match: /^GLM-5\.2$/i,            cli: 'OpenCode Go', pool: 'Z.AI',      privacy: 'restricted' },
  { match: /^GLM-5\.1$/i,            cli: 'OpenCode Go', pool: 'Z.AI',      privacy: 'restricted' },
  { match: /^GPT-5\.6 Luna$/i,       cli: 'OpenCode Go', pool: 'OpenAI',    privacy: 'western' },
  { match: /^Grok 4\.5$/i,           cli: 'OpenCode Go', pool: 'xAI',       privacy: 'western' },
  { match: /^Kimi K3$/i,             cli: 'OpenCode Go', pool: 'Moonshot',  privacy: 'restricted' },
  { match: /^Qwen3\.7 Max$/i,        cli: 'OpenCode Go', pool: 'Alibaba',   privacy: 'restricted' },
  { match: /^MiniMax-M3$/i,          cli: 'OpenCode Go', pool: 'MiniMax',   privacy: 'restricted' },
  // Codex -- confermato solo Terra a effort max
  { match: /^GPT-5\.6 Terra$/i,      cli: 'Codex Plus',  pool: 'OpenAI',    privacy: 'western' },
  // Claude Code -- canale gia' dichiarato nel CRM, va nel catalogo
  { match: /^Claude Opus 5$/i,       cli: 'Claude Code', pool: 'Anthropic', privacy: 'western' },
  { match: /^Claude Sonnet 5$/i,     cli: 'Claude Code', pool: 'Anthropic', privacy: 'western' },
  { match: /^Claude Fable 5$/i,      cli: 'Claude Code', pool: 'Anthropic', privacy: 'western' },
  { match: /^Claude 4\.5 Haiku$/i,   cli: 'Claude Code', pool: 'Anthropic', privacy: 'western' },
];

function seatFor(canonical) {
  const seat = SEATS.find(function (s) { return s.match.test(canonical); });
  return seat
    ? { cli: seat.cli, pool: seat.pool, privacy: seat.privacy, available: true }
    : { cli: '', pool: '', privacy: 'unknown', available: false };
}

function buildCatalog(apiModels) {
  const byCanonical = new Map();

  for (const model of apiModels) {
    const score = model.evaluations
      && model.evaluations.artificial_analysis_intelligence_index;
    if (!Number.isFinite(score)) continue;          // senza indice non e' verificabile

    const canonical = canonicalName(model.name);
    const seat = seatFor(canonical);
    if (!seat.available) continue;                  // non l'abbiamo, non ci serve

    // Piu' varianti di effort per famiglia: teniamo la piu' capace, che e'
    // l'intento originale delle regole "(max)" del seed.
    const prev = byCanonical.get(canonical);
    if (prev && prev.aa_score >= score) continue;

    const pricing = model.pricing || {};
    byCanonical.set(canonical, {
      key: slug(canonical),
      model_name: model.name,
      canonical_name: canonical,
      provider: (model.model_creator && model.model_creator.name) || 'Unknown',
      aa_rank: null,                                // assegnato dopo, sull'ordine
      aa_score: score,
      input_usd_per_million: Number(pricing.price_1m_input_tokens),
      output_usd_per_million: Number(pricing.price_1m_output_tokens),
      blended_usd_per_million: Number(pricing.price_1m_blended_3_to_1),
      context_window: '',                           // assente nell'API v2
      released: model.release_date || '',
      source_url: 'https://artificialanalysis.ai/models/' + (model.slug || ''),
      source: 'Artificial Analysis',
      certainty: 'verified',
      cli: seat.cli,
      pool: seat.pool,
      privacy: seat.privacy,
      available: true,
      // Gli eval per dominio servono a roleFit: lcr per L-Arch, tau_banking
      // per L-Build, coding_index per L-Code, terminalbench per L-Sys,
      // ifbench per L-Bulk. Passati interi invece di sceglierne due a monte.
      evaluations: model.evaluations || {},
    });
  }

  const catalog = [...byCanonical.values()].sort(function (a, b) {
    return b.aa_score - a.aa_score;
  });
  catalog.forEach(function (record, i) { record.aa_rank = i + 1; });
  return catalog;
}

module.exports = { buildCatalog, canonicalName, SEATS };
