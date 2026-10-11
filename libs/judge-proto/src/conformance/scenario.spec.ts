import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expand } from './expand';
import { loadScenario, loadScenarios } from './scenario';

const writeScenario = (name: string, body: string): string => {
  const path = join(mkdtempSync(join(tmpdir(), 'scenario-')), `${name}.yaml`);
  writeFileSync(path, `name: ${name}\nsummary: s\n${body}`);
  return path;
};

describe('conformance scenarios', () => {
  it('loads every vendored scenario and every message in it round-trips', () => {
    const scenarios = loadScenarios();
    expect(new Set(scenarios.map((scenario) => scenario.name)).size).toBe(
      scenarios.length,
    );
  });

  it('refuses a field the message does not have', () => {
    const path = writeScenario(
      'typo',
      'applies_to: [bridge]\nsetup: {judges: [{name: j1}]}\nsteps:\n  - judge: {from: j1, message: {accepted: {seqq: 1}}}\n',
    );
    expect(() => loadScenario(path)).toThrow(
      /step 1: not a JudgeMessage: \$\.accepted\.seqq/,
    );
  });

  it('refuses an unknown judge, a step with two keys and a name that is not the file name', () => {
    const unknown = writeScenario(
      'unknown',
      'applies_to: [bridge]\nsetup: {judges: [{name: j1}]}\nsteps:\n  - drop: {judge: j2}\n',
    );
    expect(() => loadScenario(unknown)).toThrow(/unknown judge j2/);
    const double = writeScenario(
      'double',
      'applies_to: [bridge]\nsetup: {judges: [{name: j1}]}\nsteps:\n  - {drop: {judge: j1}, wait: {ms: 1}}\n',
    );
    expect(() => loadScenario(double)).toThrow(/exactly one of/);
    const renamed = join(
      mkdtempSync(join(tmpdir(), 'scenario-')),
      'other.yaml',
    );
    writeFileSync(
      renamed,
      'name: first\nsummary: s\napplies_to: [bridge]\nsetup: {judges: [{name: j1}]}\nsteps: []\n',
    );
    expect(() => loadScenario(renamed)).toThrow(
      /name first must equal the file name/,
    );
  });

  it('accepts a second connection `as` another judge and refuses a dangling one', () => {
    const body = (judges: string) =>
      `applies_to: [bridge]\nsetup: {judges: ${judges}}\nsteps:\n  - drop: {judge: j1b}\n`;
    expect(
      loadScenario(
        writeScenario('second', body('[{name: j1}, {name: j1b, as: j1}]')),
      ).setup.judges[1].as,
    ).toBe('j1');
    expect(() =>
      loadScenario(writeScenario('dangling', body('[{name: j1b, as: j1}]'))),
    ).toThrow(/judge j1b: as j1 must name another judge/);
    expect(() =>
      loadScenario(writeScenario('self', body('[{name: j1b, as: j1b}]'))),
    ).toThrow(/as j1b must name another judge/);
  });

  it('refuses a bridge restart in a scenario the judge runs', () => {
    const path = writeScenario(
      'restart',
      'applies_to: [bridge, judge]\nsetup: {judges: [{name: j1}]}\nsteps:\n  - restart_bridge: {}\n',
    );
    expect(() => loadScenario(path)).toThrow(
      /restart_bridge needs applies_to: \[bridge\]/,
    );
  });

  it('expands placeholders and generators like the Rust runner', () => {
    const bindings = new Map([['s1', 'uuid-1']]);
    expect(
      expand(
        {
          ref: { submissionId: '{{s1}}' },
          log: { $repeat: ['ab', 3] },
          cases: { $cases: [2, 'STATUS_AC'] },
        },
        bindings,
      ),
    ).toEqual({
      ref: { submissionId: 'uuid-1' },
      log: 'ababab',
      cases: [
        { position: 1, status: 'STATUS_AC' },
        { position: 2, status: 'STATUS_AC' },
      ],
    });
    expect(() => expand('{{s9}}', bindings)).toThrow(
      /unbound placeholder \{\{s9\}\}/,
    );
  });
});
