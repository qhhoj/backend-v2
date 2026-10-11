import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PandocService } from './pandoc.service';

const probe = spawnSync('pandoc', ['--version'], { encoding: 'utf8' });
const pandocMajor =
  probe.status === 0
    ? Number(probe.stdout.split('\n')[0].split(' ')[1].split('.')[0])
    : 0;
/** CI must fail, not skip, when pandoc is missing. */
const describeWithPandoc =
  Boolean(process.env.CI) || pandocMajor >= 3 ? describe : describe.skip;

describeWithPandoc('PandocService (pandoc >= 3)', () => {
  const pandoc = new PandocService();
  it('converts Polygon TeX to Markdown through the legacy filter', async () => {
    const markdown = await pandoc.texToMarkdown(
      "\\bf{Bold} and $x^2$ with \\t{code} and ``quoted'' -- dash.",
    );
    expect(markdown).toContain('**Bold**');
    expect(markdown).toContain('$x^2$');
    expect(markdown).toContain(
      '<span style="font-family: courier new,monospace;">code</span>',
    );
    expect(markdown).toContain('"quoted"');
    expect(markdown).toContain('&ndash;');
    expect(markdown).not.toMatch(/[“”‘’]/);
  }, 30000);
  it('fences code blocks even without a language', async () => {
    expect(
      await pandoc.texToMarkdown('\\begin{verbatim}\n1 2\n\\end{verbatim}'),
    ).toMatch(/^```[ \t]*\n1 2\n```$/m);
  }, 30000);
  it.each([
    ['\\input{SECRET}'],
    ['\\include{SECRET}'],
    ['\\verbatiminput{SECRET}'],
    ['\\lstinputlisting{SECRET}'],
  ])(
    'never reads local files through %s',
    async (command) => {
      const directory = mkdtempSync(join(tmpdir(), 'qhhoj-secret-'));
      const secret = join(directory, 'SECRET');
      writeFileSync(secret, 'TOP-SECRET-CONTENT');
      writeFileSync(`${secret}.tex`, 'TOP-SECRET-CONTENT');
      const markdown = await pandoc
        .texToMarkdown(command.replace('SECRET', secret))
        .catch((error: Error) => error.message);
      expect(markdown).not.toContain('TOP-SECRET-CONTENT');
    },
    30000,
  );
  it('rejects a billion-laughs macro expansion well within the timeout', async () => {
    const macros = ['\\newcommand{\\la}{lol}'];
    for (let level = 1; level < 14; level += 1) {
      const previous = `\\l${String.fromCharCode(96 + level)}`;
      macros.push(
        `\\newcommand{\\l${String.fromCharCode(97 + level)}}{${previous.repeat(10)}}`,
      );
    }
    const started = Date.now();
    await expect(
      pandoc.texToMarkdown(`${macros.join('\n')}\n\\ln`),
    ).rejects.toThrow('statement conversion ran out of memory');
    expect(Date.now() - started).toBeLessThan(30_000);
  }, 40000);
});

/** A stand-in binary: the shell script receives what pandoc would. */
const fakePandoc = (script: string, limits: Record<string, number> = {}) => {
  const path = join(mkdtempSync(join(tmpdir(), 'qhhoj-fake-')), 'pandoc');
  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, 0o755);
  return new (class extends PandocService {
    protected readonly binary = path;
    protected readonly limits = {
      timeoutMs: 60_000,
      maxInputBytes: 1024 * 1024,
      maxOutputBytes: 8 * 1024 * 1024,
      maxMemoryBytes: 768 * 1024 * 1024,
      ...limits,
    };
  })();
};

describe('PandocService process handling', () => {
  it('runs the sandboxed latex reader with the TeX on stdin only', async () => {
    const echo = fakePandoc('echo "ARGS: $*"; cat');
    const output = await echo.texToMarkdown('HOSTILE $(touch /tmp/pwned) `x`');
    const [argsLine, ...input] = output.split('\n');
    expect(argsLine).toContain('--sandbox');
    expect(argsLine).toContain('-f latex');
    expect(argsLine).toContain('-t gfm');
    expect(argsLine).not.toContain('HOSTILE');
    expect(input.join('\n')).toContain('HOSTILE $(touch /tmp/pwned) `x`');
    expect(input.join('\n')).toContain('\\renewcommand{\\bf}{\\textbf}');
  });
  it('kills a process that outlives the timeout', async () => {
    const hang = fakePandoc('sleep 30', { timeoutMs: 300 });
    const started = Date.now();
    await expect(hang.texToMarkdown('x')).rejects.toThrow('pandoc timed out');
    expect(Date.now() - started).toBeLessThan(10_000);
  });
  it('kills a process whose output exceeds the cap', async () => {
    const flood = fakePandoc('yes', { maxOutputBytes: 1000 });
    const started = Date.now();
    await expect(flood.texToMarkdown('x')).rejects.toThrow('too large');
    expect(Date.now() - started).toBeLessThan(10_000);
  });
  it('settles at the timeout even when a grandchild outside the group keeps the pipes', async () => {
    // Settling takes ~0.3s; waiting for the orphan's pipes would take its full 30s, so 10s separates the two on any runner.
    const orphan = fakePandoc('setsid sleep 30 &\nsleep 30', {
      timeoutMs: 300,
    });
    const started = Date.now();
    await expect(orphan.texToMarkdown('x')).rejects.toThrow('pandoc timed out');
    expect(Date.now() - started).toBeLessThan(10_000);
  });
  it('limits the address space and reports exhaustion as an import error', async () => {
    const greedy = fakePandoc(
      `python3 -c 'bytearray(1024**3)' 2>/dev/null || { echo "pandoc: out of memory" >&2; exit 251; }`,
      { maxMemoryBytes: 256 * 1024 * 1024 },
    );
    await expect(greedy.texToMarkdown('x')).rejects.toThrow(
      'statement conversion ran out of memory',
    );
    const frugal = fakePandoc(`python3 -c 'bytearray(1024**3)' && echo ok`, {
      maxMemoryBytes: 4 * 1024 ** 3,
    });
    expect(await frugal.texToMarkdown('x')).toContain('ok');
  });
  it('fails closed when prlimit is missing', async () => {
    const unlimited = new (class extends PandocService {
      protected readonly limiter = '/nonexistent/prlimit';
    })();
    await expect(unlimited.texToMarkdown('x')).rejects.toThrow('prlimit');
    await expect(unlimited.assertAvailable()).rejects.toThrow('prlimit');
  });
  it('refuses TeX above the input cap without starting a process', async () => {
    const never = fakePandoc('exit 99', { maxInputBytes: 100 });
    await expect(never.texToMarkdown('x'.repeat(200))).rejects.toThrow(
      'too large',
    );
  });
  it('does not pass the worker environment to pandoc', async () => {
    process.env.QHHOJ_TEST_SECRET = 'hunter2';
    const env = fakePandoc('env');
    expect(await env.texToMarkdown('x')).not.toContain('hunter2');
    delete process.env.QHHOJ_TEST_SECRET;
  });
  it('rejects pandoc older than 3', async () => {
    await expect(
      fakePandoc('echo "pandoc 2.9.2"').assertAvailable(),
    ).rejects.toThrow('pandoc version must be at least 3.0.0');
    await expect(
      fakePandoc('echo "pandoc 3.1.3"').assertAvailable(),
    ).resolves.toBeUndefined();
  });
});
