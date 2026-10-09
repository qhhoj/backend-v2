import {
  anonymizeLabels,
  ghostsToCsv,
  parseGhostCell,
  parseGhostCsv,
} from './ghost-csv';

const IDS = new Map([
  ['sum', 'id-sum'],
  ['max', 'id-max'],
]);
const HEADER = 'label,caption,sum,max';

describe('parseGhostCell', () => {
  it.each([
    ['', null],
    ['  ', null],
    ['12', { problemId: 'p', minute: 12, rejectedBefore: null, points: null }],
    ['12+3', { problemId: 'p', minute: 12, rejectedBefore: 3, points: null }],
    ['12+0', { problemId: 'p', minute: 12, rejectedBefore: 0, points: null }],
    ['12+99', { problemId: 'p', minute: 12, rejectedBefore: 99, points: null }],
    ['12+100', 'invalid'],
    ['12+9999', 'invalid'],
    ['70@30', { problemId: 'p', minute: 30, rejectedBefore: null, points: 70 }],
    [
      '0.5@30+2',
      { problemId: 'p', minute: 30, rejectedBefore: 2, points: 0.5 },
    ],
    ['abc', 'invalid'],
    ['12+', 'invalid'],
    ['-5', 'invalid'],
    ['0@5', 'invalid'],
    ['0.0000001@5', 'invalid'],
    ['123456@5', 'invalid'],
    [
      '0.000001@5',
      { problemId: 'p', minute: 5, rejectedBefore: null, points: 0.000001 },
    ],
    ['123456', 'invalid'],
  ])('reads %j as %j', (text, expected) =>
    expect(parseGhostCell(text, 'p')).toEqual(expected),
  );
});

describe('parseGhostCsv', () => {
  it('reads labels, captions and the cells of each problem column, quoted commas included', () => {
    const csv = [
      HEADER,
      'Ann,School A,12+2,',
      '"Bob, Jr.",,70@30,45@50+1',
    ].join('\r\n');
    const { ghosts, errors } = parseGhostCsv(csv, IDS);
    expect(errors).toEqual([]);
    expect(ghosts).toEqual([
      {
        label: 'Ann',
        caption: 'School A',
        cells: [
          { problemId: 'id-sum', minute: 12, rejectedBefore: 2, points: null },
        ],
      },
      {
        label: 'Bob, Jr.',
        caption: '',
        cells: [
          { problemId: 'id-sum', minute: 30, rejectedBefore: null, points: 70 },
          { problemId: 'id-max', minute: 50, rejectedBefore: 1, points: 45 },
        ],
      },
    ]);
  });

  it.each([
    ['label,caption,nope\nAnn,,', /nope.*not a problem/],
    ['name,caption,sum\nAnn,,', /header must start with label,caption/],
    [`${HEADER}\nAnn,,abc,`, /Row 2: .*"abc"/],
    [`${HEADER}\nAnn,,12+9999,`, /Row 2: .*"12\+9999".*at most 99/],
    [`${HEADER}\n,,12,`, /Row 2: the label is empty/],
    [`${HEADER}\n=cmd,,12,`, /Row 2: the label starts with/],
    [`${HEADER}\n${'x'.repeat(65)},,12,`, /longer than 64/],
    [`${HEADER}\nAnn,,12,\nAnn,,13,`, /Row 3: the label repeats/],
    [`${HEADER}\nAnn,,12`, /Row 2: expected 4 fields, got 3/],
    [`${HEADER}\nAn\u0007n,,12,`, /control character/],
    ['', /empty/],
  ])('refuses %j with a row-numbered message', (csv, message) => {
    const { ghosts, errors } = parseGhostCsv(csv, IDS);
    expect(ghosts).toEqual([]);
    expect(errors.join('\n')).toMatch(message);
  });

  it.each([
    [`${HEADER}\n,,12,`, [['label_missing', 2]]],
    [`${HEADER}\n=cmd,,12,`, [['label_formula', 2]]],
    [`${HEADER}\nAnn,,12,\nAnn,,13,`, [['label_repeats', 3]]],
    [`${HEADER}\nAnn,,abc,`, [['cell_invalid', 2]]],
    [`${HEADER}\nAnn,,12`, [['columns_mismatch', 2]]],
    ['label,caption,nope\nAnn,,', [['columns_mismatch', 1]]],
    ['name,caption,sum\nAnn,,', [['header_invalid', 1]]],
    [`${HEADER}\n${'x'.repeat(65)},,12,`, [['label_invalid', 2]]],
    [
      `${HEADER}\n${'x'.repeat(65)},${'y'.repeat(65)},12,`,
      [
        ['label_invalid', 2],
        ['caption_invalid', 2],
      ],
    ],
    [`${HEADER}\nAn\u0007n,,12,`, [['control_character', 2]]],
    [`${HEADER}\nAnn,=HYPERLINK(1),12,`, [['caption_formula', 2]]],
    [`${HEADER}\n   ,,12,`, [['label_missing', 2]]],
    [
      `${HEADER}\nAnn,${'y'.repeat(65)},12,\nBob,@x,12,`,
      [
        ['caption_invalid', 2],
        ['caption_formula', 3],
      ],
    ],
    ['', [['csv_invalid', undefined]]],
  ])('reports %j as the issue codes %j', (csv, expected) => {
    const { issues } = parseGhostCsv(csv, IDS);
    expect(issues.map(({ code, row }) => [code, row])).toEqual(expected);
  });

  it('refuses more than 2000 ghosts and reports at most 50 issues', () => {
    const many = [
      HEADER,
      ...Array.from({ length: 2001 }, (_unused, index) => `g${index},,1,`),
    ].join('\n');
    expect(parseGhostCsv(many, IDS).issues).toEqual([
      { code: 'too_many_ghosts', message: 'More than 2000 ghosts' },
    ]);
    const bad = [
      HEADER,
      ...Array.from({ length: 80 }, (_unused, index) => `g${index},,bad,`),
    ].join('\n');
    expect(parseGhostCsv(bad, IDS).issues).toHaveLength(50);
    expect(parseGhostCsv(bad, IDS).errors).toHaveLength(50);
  });
});

describe('anonymizeLabels', () => {
  it('numbers the labels in order, keeps everything else and leaves the input alone', () => {
    const input = [
      { label: 'Ann', caption: 'A', cells: [] },
      { label: 'Bob', caption: 'B', cells: [] },
    ];
    expect(
      anonymizeLabels(input).map((ghost) => [ghost.label, ghost.caption]),
    ).toEqual([
      ['Ghost 001', 'A'],
      ['Ghost 002', 'B'],
    ]);
    expect(input[0].label).toBe('Ann');
  });
});

describe('ghostsToCsv', () => {
  it('exports large and tiny points so the parser reads them back', () => {
    const ghosts = [
      {
        label: 'Ann',
        caption: '',
        cells: [
          {
            problemId: 'id-sum',
            minute: 5,
            rejectedBefore: null,
            points: 0.000001,
          },
        ],
      },
      {
        label: 'Bob',
        caption: '',
        cells: [
          {
            problemId: 'id-max',
            minute: 7,
            rejectedBefore: 99,
            points: 99999.5,
          },
        ],
      },
    ];
    const columns = [
      { problemId: 'id-sum', code: 'sum' },
      { problemId: 'id-max', code: 'max' },
    ];
    expect(parseGhostCsv(ghostsToCsv(ghosts, columns), IDS).ghosts).toEqual(
      ghosts,
    );
  });

  it('round-trips through the parser', () => {
    const csv = [HEADER, 'Ann,"School, A",12+2,', 'Bob,,70@30,45@50+1'].join(
      '\r\n',
    );
    const parsed = parseGhostCsv(csv, IDS).ghosts;
    const columns = [
      { problemId: 'id-sum', code: 'sum' },
      { problemId: 'id-max', code: 'max' },
    ];
    expect(parseGhostCsv(ghostsToCsv(parsed, columns), IDS).ghosts).toEqual(
      parsed,
    );
  });
});
