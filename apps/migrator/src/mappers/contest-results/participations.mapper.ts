import { Injectable } from '@nestjs/common';
import { MapCtx, MappedDocument, Mapper, withoutFields } from '../../mapper';
import { importedParticipation } from '../imported-rows';

type Row = {
  id: number;
  start: Date;
  score: number;
  cumtime: number;
  virtual: number;
  contest_id: number;
  user_id: number;
  is_disqualified: number;
  tiebreaker: number | null;
  frozen_cumtime: number | null;
  frozen_score: number | null;
  frozen_tiebreaker: number | null;
};

/** Legacy marks a registration (not joined yet) with `real_start` at the epoch. */
const REGISTRATION_SENTINEL_BEFORE = Date.UTC(1970, 0, 2);
/** Owned by `recomputeParticipation` (D3). */
const RECOMPUTED = [
  'score',
  'cumtime',
  'tiebreaker',
  'frozenScore',
  'frozenCumtime',
  'frozenTiebreaker',
  'formatData',
  'frozenFormatData',
  'updatedAt',
];

@Injectable()
export class ParticipationsMapper implements Mapper<Row> {
  name = 'contest-participations';
  collection = 'contestParticipations';
  refTables = [
    'judge_contestparticipation',
    'judge_contest',
    'judge_profile',
    'auth_user',
  ];
  sql = `SELECT p.id, p.start, p.score, p.cumtime, p.\`virtual\`, p.contest_id, p.user_id, p.is_disqualified,
    p.tiebreaker, p.frozen_cumtime, p.frozen_score, p.frozen_tiebreaker
    FROM judge_contestparticipation p ${importedParticipation('p')} ORDER BY p.id`;

  map(row: Row, ctx: MapCtx): MappedDocument {
    const realStart = ctx.date(row.start) ?? new Date(0);
    const virtual = Number(row.virtual);
    const isRegistered =
      virtual === 0 && realStart.getTime() < REGISTRATION_SENTINEL_BEFORE;
    return {
      _id: ctx.ref('judge_contestparticipation', row.id)!,
      contest: ctx.ref('judge_contest', row.contest_id)!,
      user: ctx.ref('judge_profile', row.user_id)!,
      realStart,
      virtual,
      isRegistered,
      isDisqualified: ctx.bool(row.is_disqualified),
      score: Number(row.score ?? 0),
      cumtime: Number(row.cumtime ?? 0),
      tiebreaker: Number(row.tiebreaker ?? 0),
      frozenScore: Number(row.frozen_score ?? 0),
      frozenCumtime: Number(row.frozen_cumtime ?? 0),
      frozenTiebreaker: Number(row.frozen_tiebreaker ?? 0),
      formatData: {},
      frozenFormatData: {},
      // A registration has no join time: its `start` is the epoch sentinel, not a creation date.
      createdAt: isRegistered ? null : realStart,
      updatedAt: isRegistered ? null : realStart,
    };
  }

  normalize(doc: MappedDocument) {
    return withoutFields(doc, RECOMPUTED);
  }
}
