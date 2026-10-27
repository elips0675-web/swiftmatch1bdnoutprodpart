# Documentation map

This repository uses a small, explicit doc structure:

## 1. Active canonical documentation

These are the only files that define working rules and instructions.

- `AGENTS.md` — project navigation and high-level rules
- `README.md` — project overview, stack, run instructions, gates
- `project-context.md` — architecture and environment context
- `docs/AGENTS-*.md` — domain-specific rules and workflows
- `docs/product-roadmap.md` — roadmap and non-canonical product ideas
- `Что сделано.txt` — log of completed stages
- `Что доделать.txt` — active backlog
- `Промты.txt` — index of topics to canonical rules

## 2. Archive / legacy documentation

These files are historical snapshots, drafts, and session notes. They are not a source of truth.

- `docs/archive/README.md` — archive index
- Old root-level prompt/evaluation files in the repo root are considered legacy unless they are explicitly referenced from the active docs

## 3. Rules for documentation hygiene

- Do not add new product rules to root-level `.txt` files.
- If a file is not referenced by `AGENTS.md`, `README.md`, or a canonical doc, treat it as archival.
- Prefer `docs/AGENTS-*.md` over duplicate rule copies in root `.txt` files.
- Use `Что сделано.txt` and `Что доделать.txt` for work state, not for long-form rule definitions.
- Keep one canonical source per topic; avoid parallel versions of the same instruction.

## 4. When to archive

Archive or remove a doc when it is:

- a draft, assessment, or session transcript
- a duplicate of another source-of-truth file
- a stale snapshot with no active link from canonical docs
- a prompt or evaluation artifact that was superseded by the docs in `docs/`

## 5. Expected structure

```text
AGENTS.md
README.md
project-context.md
docs/
  README.md
  AGENTS-*.md
  product-roadmap.md
  archive/
    README.md
Что сделано.txt
Что доделать.txt
Промты.txt
```

This structure keeps the project readable, keeps the canonical rules in one place, and prevents old drafts from being mistaken for current instructions.
