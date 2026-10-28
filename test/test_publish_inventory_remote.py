#!/usr/bin/env python3
"""Il remote di push non deve mai ricadere su `origin` senza dichiararlo.

Issue NeXgen-Engine#141: su un clone il cui `origin` e' il repo pubblico
dell'engine, uno script che di default spinge su `origin` pubblica il vault o
lascia il commit orfano. La precedenza e' quella di
`nexgen_core/git_ops.py:resolve_remotes`: variabile esplicita, poi
`authoritative_remote` in `sync/remotes.yaml`, poi `origin` come ultima
risorsa. Con `local` o `none` non si spinge affatto.
"""
from __future__ import annotations

import importlib.util
import io
from contextlib import redirect_stderr
from pathlib import Path
from types import SimpleNamespace

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "scripts" / "governor-publish-inventory.py"


def _module():
    spec = importlib.util.spec_from_file_location("governor_publish_inventory", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _vault(tmp_path: Path, authoritative: str | None) -> Path:
    """A clone shaped like the one in the report: remotes.yaml, or nothing."""
    vault = tmp_path / "vault"
    (vault / "03-INFRA").mkdir(parents=True)
    if authoritative is not None:
        declared = vault / "03-INFRA" / "agent-universal-layer" / "sync" / "remotes.yaml"
        declared.parent.mkdir(parents=True)
        declared.write_text(
            f"schema_version: 1\nauthoritative_remote: {authoritative}\nmirrors: []\n",
            encoding="utf-8",
        )
    return vault


@pytest.fixture()
def mod(tmp_path, monkeypatch):
    module = _module()
    monkeypatch.delenv("KNOWLEDGE_VAULT_REMOTE", raising=False)
    monkeypatch.setattr(module, "VAULT", tmp_path / "vault")
    return module


def test_explicit_variable_wins_over_the_declaration(mod, tmp_path, monkeypatch):
    module = mod
    monkeypatch.setattr(module, "VAULT", _vault(tmp_path, "vault"))
    monkeypatch.setenv("KNOWLEDGE_VAULT_REMOTE", "mirror-esplicito")

    assert module.push_remote() == "mirror-esplicito"


def test_declared_authoritative_remote_is_used_when_the_variable_is_absent(mod, tmp_path):
    module = mod
    monkeypatch_vault = _vault(tmp_path, "vault")
    module.VAULT = monkeypatch_vault

    assert module.push_remote() == "vault"


def test_no_declaration_falls_back_to_origin(mod, tmp_path):
    module = mod
    module.VAULT = _vault(tmp_path, None)

    assert module.push_remote() == "origin"


def test_inline_comment_and_quotes_do_not_become_part_of_the_name(mod, tmp_path):
    module = mod
    vault = _vault(tmp_path, None)
    declared = vault / "03-INFRA" / "agent-universal-layer" / "sync" / "remotes.yaml"
    declared.parent.mkdir(parents=True)
    declared.write_text('authoritative_remote: "vault"   # il bare del VPS\n', encoding="utf-8")
    module.VAULT = vault

    assert module.push_remote() == "vault"


def _record_git(monkeypatch, module, calls: list[list[str]]) -> None:
    """Records the git commands and pretends each one succeeded."""

    def fake_run(cmd, **kwargs):
        calls.append(list(cmd))
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(module.subprocess, "run", fake_run)


def _prepare_write(monkeypatch, module, vault: Path) -> None:
    module.VAULT = vault
    module.NOTE = vault / "03-INFRA" / "council-model-inventory.md"
    module.PROBES = [("finto", lambda: (["modello"], ""))]
    monkeypatch.setattr(module, "HOST", "host-di-prova")
    monkeypatch.setattr(module, "BEGIN", "<!-- model-inventory:host-di-prova:start -->")
    monkeypatch.setattr(module, "END", "<!-- model-inventory:host-di-prova:end -->")


def test_local_authoritative_remote_commits_and_never_pushes(tmp_path, monkeypatch):
    module = mod = _module()
    monkeypatch.delenv("KNOWLEDGE_VAULT_REMOTE", raising=False)
    vault = _vault(tmp_path, "local")
    _prepare_write(monkeypatch, module, vault)
    calls: list[list[str]] = []
    _record_git(monkeypatch, module, calls)
    monkeypatch.setattr(module.sys, "argv", ["x", "--write", "--push", "--stamp", "2026-10-28 12:00"])

    err = io.StringIO()
    with redirect_stderr(err):
        module.main()

    assert any(cmd[:2] == ["git", "commit"] for cmd in calls), "il commit resta"
    assert not any(cmd[:2] == ["git", "push"] for cmd in calls), "con 'local' non si spinge"
    assert "local" in err.getvalue()


def test_declared_remote_is_the_one_git_pushes_to(tmp_path, monkeypatch):
    module = _module()
    monkeypatch.delenv("KNOWLEDGE_VAULT_REMOTE", raising=False)
    vault = _vault(tmp_path, "vault")
    _prepare_write(monkeypatch, module, vault)
    calls: list[list[str]] = []
    _record_git(monkeypatch, module, calls)
    monkeypatch.setattr(module.sys, "argv", ["x", "--write", "--push", "--stamp", "2026-10-28 12:00"])

    with redirect_stderr(io.StringIO()):
        module.main()

    pushes = [cmd for cmd in calls if cmd[:2] == ["git", "push"]]
    assert pushes and pushes[0][3] == "vault", f"push verso il remote sbagliato: {pushes}"
