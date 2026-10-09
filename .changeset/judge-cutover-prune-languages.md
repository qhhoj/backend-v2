---
'qhhoj-backend': minor
---

Migrator: `prune-languages --keep KEY,KEY [--dry-run]` removes every language outside the judge fleet's list from all problems and disables its row (`includeInProblem: false`); rows are never deleted, so past submissions (GAS32 included) keep their language. The summary lists `emptiedProblems` (problems left with no allowed language). Before any write it refuses (exit 1) a keep list with no runtime language (only OUTPUT/TEXT, as from an unset variable) and a key that names no language.
