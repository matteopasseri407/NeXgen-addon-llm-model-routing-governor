#!/usr/bin/env python3
"""Pubblica nel vault l'inventario dei modelli che questo host puo' invocare.

Parte del DLC Model Routing Governor. I CLI (`opencode`, `agy`, `codex`,
`claude`, `ollama`) girano sulle macchine locali, spesso spente quando il
workflow parte: ogni macchina, quando e' accesa, pubblica cosa espone in una
nota del vault; il workflow la legge via MCP. La VPS non raggiunge mai i PC.

    python3 governor-publish-inventory.py             # anteprima
    python3 governor-publish-inventory.py --write     # scrive la nota
    python3 governor-publish-inventory.py --write --push   # committa e spinge

Il blocco e' PER HOST: la macchina con Ollama puo' avere il ruolo Privacy,
quella senza no. Un inventario unico mentirebbe su entrambe.

Questo script NON incrocia con Artificial Analysis: pubblica solo cosa c'e'.
Il punteggio lo mette il workflow, che ha la chiave API.

Il remote di push si risolve come fa l'engine (`nexgen_core/git_ops.resolve_remotes`):
`KNOWLEDGE_VAULT_REMOTE` se impostata, poi `authoritative_remote` dichiarato in
`03-INFRA/agent-universal-layer/sync/remotes.yaml`, poi `origin` come ultima
risorsa. Se il remoto autorevole e' `local` o `none` lo script committa e NON
spinge: ripiegare su `origin` pubblicherebbe il vault sul repo pubblico che
quella dichiarazione esiste per proteggere.
"""
import argparse
import json
import os
import platform
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

VAULT = Path(__file__).resolve().parent.parent
NOTE = VAULT / "03-INFRA" / "council-model-inventory.md"

HOST = platform.node()
RETRIES = 4          # `agy models` risponde a intermittenza: va ritentato
TIMEOUT = 60


def run(cmd):
    """(righe, nota). Un CLI assente o muto non e' un errore fatale.

    L'output passa da FILE, mai da pipe: `agy models` pende per sempre se
    stdout o stderr e' una pipe (osservato il 2026-08-22), mentre con un file
    risponde in secondi. Vale per qualsiasi fd: anche solo stderr in pipe
    appende il comando.
    """
    if not shutil.which(cmd[0]):
        return None, f"`{cmd[0]}` non installato su questo host"
    last = ""
    for attempt in range(RETRIES):
        # start_new_session: allo scadere del tempo va ucciso il gruppo, non il
        # solo figlio. I nipoti orfani tengono vivo il cgroup del servizio e lo
        # portano al timeout di systemd anche quando lo script e' gia' uscito.
        tmp = Path(tempfile.mkdtemp(prefix="gov-inv-"))
        out_f, err_f = tmp / "out", tmp / "err"
        try:
            with out_f.open("w", encoding="utf-8") as of, err_f.open("w", encoding="utf-8") as ef:
                with subprocess.Popen(cmd, stdout=of, stderr=ef, start_new_session=True) as proc:
                    try:
                        proc.communicate(timeout=TIMEOUT)
                    except subprocess.TimeoutExpired:
                        os.killpg(proc.pid, signal.SIGKILL)
                        proc.communicate()
                        # un comando appeso resta appeso: i ritentativi servono per le
                        # risposte intermittenti, non per chi non risponde affatto.
                        return None, f"scaduto dopo {TIMEOUT}s"
                    # alcuni CLI (agy) lasciano un nipote vivo dopo l'uscita:
                    # se resta nel gruppo, tiene occupato il cgroup del servizio
                    # e systemd lo kill-a solo dopo il timeout di stop (90s).
                    # Il gruppo e' dedicato (start_new_session), quindi ucciderlo
                    # non tocca nient'altro.
                    try:
                        os.killpg(proc.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
            out = out_f.read_text(encoding="utf-8")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        if proc.returncode != 0:
            last = f"uscito con {proc.returncode}"
            continue
        lines = [l.strip() for l in out.splitlines() if l.strip()]
        if lines:
            note = "" if attempt == 0 else f"al tentativo {attempt + 1}"
            return lines, note
        last = "output vuoto"
    return None, last or "nessuna risposta"


def probe_opencode():
    """I modelli NVIDIA li toglie di mezzo: li elenca `probe_nvidia`.

    `opencode models` prende il catalogo NVIDIA da models.dev, che resta
    indietro: propone `deepseek-ai/deepseek-v4-pro` e `deepseek-v4-flash`
    quando l'endpoint risponde gia' 410 Gone. La disponibilita' vera la sa
    solo `/v1/models`, quindi quel canale si sonda a parte.
    """
    ds_fetch = Path(__file__).resolve().parent / "scripts" / "ensure-deepseek-key.sh"
    if ds_fetch.exists():
        try:
            subprocess.run(["bash", str(ds_fetch)], capture_output=True, timeout=30)
        except Exception:
            pass
    lines, note = run(["opencode", "models"])
    if not lines:
        return lines, note
    return [l for l in lines if not l.startswith("nvidia/")], note


def probe_nvidia():
    """Catalogo vivo di build.nvidia.com, non quello di models.dev.

    E' un abbonamento che vive sulla macchina come gli altri: la chiave sta
    qui, non su Oracle, e il workflow non la vede mai. Restituisce gli slug
    nudi (`nvidia/nemotron-3-ultra-550b-a55b`); il prefisso di canale lo
    aggiunge il governor quando compone lo slug per opencode.
    """
    key = os.environ.get("NVIDIA_API_KEY")
    if not key:
        conf = Path.home() / ".config" / "environment.d" / "93-nvidia-api.conf"
        if not conf.exists():
            # Prima di arrendersi: la chiave vive nel credential store di n8n,
            # non nel vault. Una macchina nuova se la ripesca da li' invece di
            # aspettare che qualcuno la copi a mano. Best-effort e silenzioso:
            # se Oracle e' giu' si riprova domani, il timer e' giornaliero.
            fetch = Path(__file__).resolve().parent / "scripts" / "ensure-nvidia-key.sh"
            if fetch.exists():
                try:
                    subprocess.run(["bash", str(fetch)], capture_output=True, timeout=90)
                except Exception:
                    pass
        if not conf.exists():
            return None, "nessuna NVIDIA_API_KEY su questo host"
        for line in conf.read_text(encoding="utf-8").splitlines():
            if line.startswith("NVIDIA_API_KEY="):
                key = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not key:
        return None, "chiave NVIDIA illeggibile"
    req = urllib.request.Request(
        "https://integrate.api.nvidia.com/v1/models",
        headers={"Authorization": "Bearer " + key})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            data = json.load(r)
    except Exception as e:
        return None, f"endpoint non raggiungibile: {type(e).__name__}"
    ids = sorted(m["id"] for m in data.get("data", []) if m.get("id"))
    return (ids, "") if ids else (None, "catalogo vuoto")


def probe_agy():
    """`agy models` stampa `slug<TAB>Nome Visualizzato`, non il solo slug.

    Senza tagliare, nell'inventario finisce `gemini-3.6-flash-high\tGemini 3.6
    Flash (High)` e il governor non aggancia piu' Artificial Analysis: cerca un
    modello il cui nome contiene un tab, che ovviamente non esiste. Gli altri
    CLI danno gia' il solo slug, quindi il taglio li lascia intatti.
    """
    lines, note = run(["agy", "models"])
    if not lines:
        return lines, note
    return [l.split("\t")[0].strip() for l in lines], note


def probe_codex():
    """Codex non elenca i modelli da CLI: la lista sta nella sua cache."""
    cache = Path.home() / ".codex" / "models_cache.json"
    if not cache.exists():
        return None, "models_cache.json assente"
    try:
        data = json.loads(cache.read_text(encoding="utf-8"))
    except Exception as e:
        return None, f"cache illeggibile: {e!r}"
    models = data.get("models") or []
    if isinstance(models, dict):
        models = list(models.values())
    # `visibility: hide` non e' selezionabile dall'utente.
    out = [m["slug"] for m in models
           if m.get("slug") and m.get("visibility") != "hide"]
    return (out, "") if out else (None, "cache senza modelli visibili")


def probe_claude():
    """Claude Code: lo standard piu' le opzioni extra del piano."""
    base = ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"]
    extra = []
    for cfg in sorted((Path.home() / ".claude" / "backups").glob(".claude.json.backup.*"))[-1:]:
        try:
            data = json.loads(cfg.read_text(encoding="utf-8", errors="replace"))
        except Exception:
            continue
        for opt in data.get("additionalModelOptionsCache") or []:
            v = re.sub(r"\[.*\]$", "", str(opt.get("value") or "")).strip()
            if v and v not in base:
                extra.append(v)
    if not shutil.which("claude"):
        return None, "`claude` non installato su questo host"
    return base + extra, ("piu' le opzioni extra del piano" if extra else "")


def probe_ollama():
    """I locali sono l'unica risposta possibile per il ruolo Privacy."""
    lines, note = run(["ollama", "list"])
    if lines is None:
        return None, note
    models = [l.split()[0] for l in lines[1:] if l.split()]   # salta l'header
    if not models:
        return None, "ollama attivo ma senza modelli scaricati"
    return models, note


PROBES = [
    ("opencode", probe_opencode),
    ("nvidia", probe_nvidia),
    ("agy", probe_agy),
    ("codex", probe_codex),
    ("claude", probe_claude),
    ("local", probe_ollama),
]

BEGIN = f"<!-- model-inventory:{HOST}:start -->"
END = f"<!-- model-inventory:{HOST}:end -->"


def render(results, stamp):
    L = [BEGIN, f"### Host `{HOST}`", ""]
    L.append(f"Rilevato il {stamp} da `governor-publish-inventory.py`.")
    L.append("")
    total = sum(len(v) for v, _ in results.values() if v)
    L.append(f"{total} modelli invocabili su {len(results)} canali sondati.")
    L.append("")
    for cli, (models, note) in results.items():
        if models is None:
            L.append(f"- **{cli}**: non disponibile — {note}")
            continue
        suffix = f" _{note}_" if note else ""
        L.append(f"- **{cli}** ({len(models)}){suffix}: "
                 + ", ".join(f"`{m}`" for m in models))
    if results.get("local", (None, ""))[0] is None:
        L.append("")
        L.append("> Nessun modello locale su questo host: il ruolo `Privacy` "
                 "resta **non assegnato** qui. Non esiste un ripiego cloud "
                 "per dati personali.")
    L.append("")
    L.append(END)
    return "\n".join(L)


HEADER = """---
tags:
  - infra
  - ai
  - model-routing
status: active
type: reference
---

# Inventario modelli per host

Ponte fra le macchine locali e il Model Routing Governor, che gira sulla VPS
Oracle e non puo' interrogare CLI su macchine spente.

Ogni host pubblica il proprio blocco delimitato con
`governor-publish-inventory.py --write --push`. Non modificare i blocchi a
mano: vengono sovrascritti.

Il perche' dei ruoli e il processo completo stanno in
[[03-INFRA/model-routing-roles]]. La matrice risultante nel blocco governato
di [[04-NOW/model-cost-crm]].

"""


def push_remote():
    """Il remote che accetta scritture canoniche su questo clone.

    Ordine: `KNOWLEDGE_VAULT_REMOTE` (esplicito), poi `authoritative_remote`
    dichiarato in `sync/remotes.yaml`, poi `origin` come ultima risorsa. E' la
    precedenza di `nexgen_core/git_ops.py:resolve_remotes`: senza, ogni
    chiamante che omette la variabile (il boot notifier lo fa) spinge sul repo
    pubblico dell'engine e lascia il commit orfano.

    `local` e `none` escono cosi' come sono: sono una dichiarazione, non un
    nome da sostituire, e chi chiama deve rifiutarsi di spingere.
    """
    explicit = os.environ.get("KNOWLEDGE_VAULT_REMOTE")
    if explicit and explicit.strip():
        return explicit.strip()

    declared = VAULT / "03-INFRA" / "agent-universal-layer" / "sync" / "remotes.yaml"
    try:
        for line in declared.read_text(encoding="utf-8").splitlines():
            line = line.split("#", 1)[0].strip()
            if line.startswith("authoritative_remote:"):
                value = line.split(":", 1)[1].strip().strip("'\"")
                if value:
                    return value
    except OSError:  # nexgen: allow reason="senza remotes.yaml il clone non dichiara nulla: vale il default documentato"
        pass
    return "origin"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--push", action="store_true",
                    help="committa e spinge sul remote autorevole dichiarato")
    ap.add_argument("--stamp", default=None,
                    help="data del rilevamento (default: oggi via date)")
    args = ap.parse_args()

    stamp = args.stamp or subprocess.run(
        ["date", "+%Y-%m-%d %H:%M"], capture_output=True, text=True).stdout.strip()

    results = {}
    for cli, fn in PROBES:
        models, note = fn()
        results[cli] = (models, note)
        state = f"{len(models)} modelli" if models else f"NON disponibile ({note})"
        print(f"  {cli:9} {state}", file=sys.stderr)

    block = render(results, stamp)

    if not args.write:
        print(block)
        return

    if NOTE.exists():
        old = NOTE.read_text(encoding="utf-8")
        if BEGIN in old and END in old:
            i, j = old.index(BEGIN), old.index(END) + len(END)
            new = old[:i] + block + old[j:]
        else:
            new = old.rstrip("\n") + "\n\n" + block + "\n"
    else:
        new = HEADER + block + "\n"
    NOTE.write_text(new, encoding="utf-8")
    print(f"scritto: {NOTE}", file=sys.stderr)

    if args.push:
        remote = push_remote()
        rel = NOTE.relative_to(VAULT)
        for cmd in (["git", "add", str(rel)],
                    ["git", "commit", "-q", "-m",
                     f"inventory({HOST}): aggiorna i modelli invocabili"]):
            p = subprocess.run(cmd, cwd=VAULT, capture_output=True, text=True, timeout=TIMEOUT)
            if p.returncode != 0 and "nothing to commit" not in p.stdout:
                print(f"! {' '.join(cmd)} -> {p.stderr.strip() or p.stdout.strip()}",
                      file=sys.stderr)
                return
        if remote in ("local", "none"):
            print(f"! push saltato: il remote autorevole dichiarato e' '{remote}', "
                  "la nota resta committata in locale", file=sys.stderr)
            return
        cmd = ["git", "push", "-q", remote, "HEAD"]
        p = subprocess.run(cmd, cwd=VAULT, capture_output=True, text=True, timeout=TIMEOUT)
        if p.returncode != 0:
            print(f"! {' '.join(cmd)} -> {p.stderr.strip() or p.stdout.strip()}", file=sys.stderr)
            return
        print("spinto su " + remote, file=sys.stderr)


if __name__ == "__main__":
    main()
