# Problem package (`qhhoj-package` v1)

One zip with everything a problem consists of, built by the `problem-package` job for editors (`POST|GET /api/internal/problems/:code/package`).

| Path in the zip | Content |
|---|---|
| `package.json` | the manifest: `format`, `formatVersion`, problem fields, statement list, test-data configuration with every case (whether an interactive problem runs its checker, the helper header names), names of the uploaded files |
| `statements/<lang>.md` | the Markdown statement per language (`en` is the base) |
| `statements/uploaded.pdf` | the uploaded PDF statement, when there is one |
| `statement.<lang>.pdf` | a rendered PDF statement, only for languages already in the cache (the build never renders) |
| `data/` | the test archive and `init.yml` |
| `sources/` | custom checker, grader, header and generator files, and the helper headers |
| `material/` | the uploaded material file |

- The cache file is `<PDF_CACHE_ROOT>/packages/<code>.<dataVersion>.<contentHash>.zip`; the hash covers the manifest, every statement text and the two upload URLs, so any edit gives a new key and only the newest key of a problem is kept. A cache hit refreshes the zip's mtime, so the daily sweep drops zips not used for 24 hours; a code rename or a purge drops them all.
- The cache is least-recently-used: a hit refreshes the file time and eviction removes the oldest first.
- Size cap 512 MiB of content, checked before any file is written and enforced again while streaming (`409 package_too_large`); the whole cache is capped at 8 GiB and one user can request 10 packages an hour (3 per problem).
- There is no import in this program.
