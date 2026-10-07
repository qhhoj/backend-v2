"""Regenerates libs/contests/src/rating/elo-mmr.goldens.json from the legacy judge/ratings.py.

Usage: python3 -I tools/legacy/elo_mmr_goldens.py <online-judge>/judge/ratings.py libs/contests/src/rating/elo-mmr.goldens.json
"""
import json
import random
import sys
import types

# ratings.py imports Django at module level; only rate_contest uses it, so empty stand-ins suffice.
for name in ('django', 'django.db', 'django.db.models', 'django.db.models.functions', 'django.utils'):
    sys.modules[name] = types.ModuleType(name)
sys.modules['django.db'].transaction = None
for attribute in ('Count', 'OuterRef', 'Subquery'):
    setattr(sys.modules['django.db.models'], attribute, None)
sys.modules['django.db.models.functions'].Coalesce = None
sys.modules['django.utils'].timezone = None

source_path, output_path = sys.argv[1], sys.argv[2]
legacy = {}
with open(source_path) as source:
    exec(compile(source.read(), source_path, 'exec'), legacy)


def participants(rng, count, max_history, mean_range=(900.0, 2400.0)):
    rows = []
    for _ in range(count):
        history = [rng.uniform(600.0, 2800.0) for _ in range(rng.randint(0, max_history))]
        mean = legacy['MEAN_INIT'] if not history else rng.uniform(*mean_range)
        rows.append({'score': rng.choice([0, 100, 200, 300, 300, 400]), 'cumtime': rng.choice([0, 60, 120]), 'mean': mean, 'history': history})
    rows.sort(key=lambda row: (-row['score'], row['cumtime']))
    return rows


def rating_case(name, rows):
    ranking = list(legacy['tie_ranker'](rows, key=lambda row: (row['score'], row['cumtime'])))
    rating, mean, performance = legacy['recalculate_ratings'](
        ranking, [row['mean'] for row in rows], [len(row['history']) for row in rows], [list(row['history']) for row in rows],
    )
    for value, times in zip(mean, (len(row['history']) for row in rows)):
        raw = value - (legacy['sqrt'](legacy['get_var'](times + 1)) - legacy['SD_LIM'])
        if abs(raw - int(raw) - 0.5) < 1e-6:
            raise SystemExit(f'{name}: a rating sits on .5; change the seed')
    return {
        'name': name,
        'inputs': [{'rank': rank, 'mean': row['mean'], 'history': row['history'], 'score': row['score'], 'cumtime': row['cumtime']} for rank, row in zip(ranking, rows)],
        'outputs': [{'rating': r, 'mean': m, 'performance': p} for r, m, p in zip(rating, mean, performance)],
    }


rng = random.Random(20261007)
newcomer = {'score': 100, 'cumtime': 0, 'mean': legacy['MEAN_INIT'], 'history': []}
cases = [
    rating_case('single newcomer', [newcomer]),
    rating_case('two newcomers', [dict(newcomer, score=200), newcomer]),
    rating_case('three-way tie in five', [dict(newcomer, score=s) for s in (500, 300, 300, 300, 100)]),
    rating_case('everyone tied', [dict(newcomer) for _ in range(4)]),
    rating_case('long histories', participants(rng, 12, 30)),
    rating_case('forty mixed', participants(rng, 40, 8)),
    rating_case('three hundred', participants(rng, 300, 5)),
    rating_case('rating floor', [dict(newcomer, score=300)] + [{'score': 0, 'cumtime': 0, 'mean': -4000.0, 'history': [-4200.0, -4100.0]} for _ in range(3)]),
]
terms = [(1500.0, 300.0, 1.0), (1800.0, 250.0, 0.5)]
solves = [
    {'terms': terms, 'target': target, 'linearFactor': factor, 'bounds': list(legacy['VALID_RANGE']), 'result': legacy['solve'](terms, target, lin_factor=factor)}
    for target, factor in ((0.0, 0), (-1e9, 0), (1e9, 0), (0.001, 0), (5.0, 0.002))
]
ties = [
    {'keys': keys, 'ranks': list(legacy['tie_ranker'](keys, key=lambda key: key))}
    for keys in ([1], [1, 1], [1, 2, 2, 3], [5, 5, 5, 4, 3, 3])
]
with open(output_path, 'w') as output:
    json.dump({'ratings': cases, 'solves': solves, 'ties': ties}, output, indent=1)
    output.write('\n')
