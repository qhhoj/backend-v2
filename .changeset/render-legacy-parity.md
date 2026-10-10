---
'qhhoj-backend': patch
---

Statement rendering matches the old site: quotes, `...` and `--` stay as written; `##Title` without a space is a heading; a code fence right after an HTML line (`<details>`) renders as code; `$…$`/`~…~` inside raw HTML blocks (tables, lines after an `<img>`) render as math; a formula holding a lone backtick run (`~\texttt{``}~`) renders. nginx serves legacy `/martor/` image URLs from `/media/martor/`.
