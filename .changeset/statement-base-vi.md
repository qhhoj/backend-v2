---
'qhhoj-backend': patch
---

The base statement language is Vietnamese: `?lang=vi` (now the default) returns the base statement with `translated: true`; `?lang=en` without an English translation returns the Vietnamese base with `translated: false`. PDF cache keys of base statements move from `<code>.en.pdf` to `<code>.vi.pdf` (re-rendered on demand). The migrator drops a legacy `vi` translation identical to the problem's own text.
