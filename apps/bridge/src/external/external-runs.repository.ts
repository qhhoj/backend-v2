import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  ExternalRun,
  IN_FLIGHT_STATUSES,
  Problem,
  Submission,
  uuidStr,
} from '@libs/database';
import type { ExternalLanguage } from '@libs/database';
import { EXTERNAL_JUDGE_NAME } from '@libs/judging';
import type { RemoteRun } from '@libs/judging';

/** A P/G row the adapter holds. */
export interface HeldRow {
  id: string;
  generation: number;
  judgeSeq: number;
}

/** What a submit needs besides the claim. */
export interface SubmitTarget {
  oj: string;
  problemId: string;
  /** The remote language id, or null when the row's language is not mapped. */
  remoteLanguage: string | null;
}

/** The remote fields an answer updates on the run. */
const answerFields = (answer: RemoteRun) => ({
  systemStatus: answer.systemStatus,
  statusCanonical: answer.statusCanonical,
  remoteUrl: answer.remoteUrl,
  scoreText: answer.scoreText,
  runtimeMs: answer.runtimeMs,
  memoryKb: answer.memoryKb,
});

/** Mongo side of the external adapter: which rows it takes and holds, and the remote state of each run (`externalRuns`). */
@Injectable()
export class ExternalRunsRepository {
  constructor(
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
    @InjectModel(ExternalRun.name) private readonly runs: Model<ExternalRun>,
  ) {}

  /** Runs the adapter holds, oldest first. */
  async heldRows(): Promise<HeldRow[]> {
    const rows = await this.submissions
      .find(
        {
          status: { $in: [...IN_FLIGHT_STATUSES] },
          judgedOn: EXTERNAL_JUDGE_NAME,
        },
        { judgeGeneration: 1, judgeSeq: 1 },
      )
      .sort({ _id: 1 })
      .lean();
    return rows.map((row) => ({
      id: uuidStr(row._id),
      generation: row.judgeGeneration ?? 0,
      judgeSeq: row.judgeSeq ?? 0,
    }));
  }

  async heldRow(submissionId: string): Promise<HeldRow | null> {
    const row = await this.submissions
      .findOne(
        {
          _id: submissionId,
          status: { $in: [...IN_FLIGHT_STATUSES] },
          judgedOn: EXTERNAL_JUDGE_NAME,
        },
        { judgeGeneration: 1, judgeSeq: 1 },
      )
      .lean();
    return (
      row && {
        id: uuidStr(row._id),
        generation: row.judgeGeneration ?? 0,
        judgeSeq: row.judgeSeq ?? 0,
      }
    );
  }

  /** Ids of up to `limit` queued submissions of problems the external judge takes, in dispatch order. */
  async queuedIds(limit: number): Promise<string[]> {
    const problems = await this.problems
      .find({ 'externalJudge.isActive': true }, { _id: 1 })
      .lean();
    if (!problems.length || limit <= 0) return [];
    const rows = await this.submissions
      .find(
        {
          status: 'QU',
          problem: { $in: problems.map((problem) => problem._id) },
        },
        { _id: 1 },
      )
      .sort({ priority: 1, _id: 1 })
      .limit(limit)
      .lean();
    return rows.map((row) => uuidStr(row._id));
  }

  /** The problem's external link and the remote language of the submission's language; null when the problem no longer has an active link. */
  async submitTarget(submissionId: string): Promise<SubmitTarget | null> {
    const submission = await this.submissions
      .findById(submissionId, { problem: 1, language: 1 })
      .lean();
    if (!submission) return null;
    const problem = await this.problems
      .findById(submission.problem, { externalJudge: 1 })
      .lean();
    const link = problem?.externalJudge;
    if (!link?.isActive) return null;
    const language = uuidStr(submission.language);
    const mapped = link.languages.find(
      (entry: ExternalLanguage) => uuidStr(entry.language) === language,
    );
    return {
      oj: link.oj,
      problemId: link.problemId,
      remoteLanguage: mapped?.remoteId ?? null,
    };
  }

  /** `partial` of the submission's problem (false when it is gone). */
  async isPartial(submissionId: string): Promise<boolean> {
    const submission = await this.submissions
      .findById(submissionId, { problem: 1 })
      .lean();
    const problem =
      submission &&
      (await this.problems.findById(submission.problem, { partial: 1 }).lean());
    return problem?.partial ?? false;
  }

  runOf(submissionId: string): Promise<ExternalRun | null> {
    return this.runs.findById(submissionId).lean();
  }

  /** A claim starts a new run document, before the submit, so a restart can tell a run that never got a remote id. */
  async start(
    submissionId: string,
    generation: number,
    target: SubmitTarget & { remoteLanguage: string },
  ): Promise<void> {
    await this.runs.replaceOne(
      { _id: submissionId },
      {
        _id: submissionId,
        generation,
        oj: target.oj,
        problemId: target.problemId,
        remoteLanguage: target.remoteLanguage,
      },
      { upsert: true },
    );
  }

  async submitted(
    submissionId: string,
    generation: number,
    answer: RemoteRun,
  ): Promise<void> {
    await this.runs.updateOne(
      { _id: submissionId, generation },
      {
        $set: {
          ...answerFields(answer),
          remoteId: answer.remoteId,
          submittedAt: new Date(),
        },
      },
    );
  }

  async answered(
    submissionId: string,
    generation: number,
    answer: RemoteRun,
  ): Promise<void> {
    await this.runs.updateOne(
      { _id: submissionId, generation },
      {
        $set: {
          ...answerFields(answer),
          lastPolledAt: new Date(),
          pollErrors: 0,
        },
      },
    );
  }

  async pollFailed(submissionId: string, generation: number): Promise<void> {
    await this.runs.updateOne(
      { _id: submissionId, generation },
      { $set: { lastPolledAt: new Date() }, $inc: { pollErrors: 1 } },
    );
  }
}
