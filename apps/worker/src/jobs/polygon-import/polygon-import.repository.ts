import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { permissionsOf } from '@libs/auth';
import type { Permission } from '@libs/auth';
import { isDocumentTooLarge, isDuplicateKey } from '@libs/common';
import {
  DATA_FILE_KINDS,
  dataVersionIs,
  emptyProblemData,
  Group,
  Language,
  Problem,
  ProblemGroup,
  ProblemType,
  PROBLEM_LIMITS,
  Revision,
  User,
  uuidStr,
} from '@libs/database';
import type { ProblemData, ProblemTranslation } from '@libs/database';
import { dataChanges, fieldDiff } from '@libs/problems';
import type { PolygonImportJob } from '@libs/problems';
import type { ClientSession, Connection, Model } from 'mongoose';
import { PolygonImportError } from './polygon-import.error';

export interface ImportedProblem {
  name: string;
  description: string;
  descriptionHtml: string;
  translations: ProblemTranslation[];
  solution: { content: string; contentHtml: string } | null;
  timeLimit: number;
  memoryLimit: number;
  partial: boolean;
  data: ProblemData;
}

/** What the job found when it started: the problem's data version for the compare-and-set, `null` when it does not exist yet. */
export type ImportTarget = { dataVersion: number } | null;

export interface AppliedImport {
  problemId: string;
  /** Data files the previous configuration named; the caller removes those the new one no longer uses. */
  previousFiles: string[];
  /** The problem's `dataVersion` after the import; the caller stamps the data directory with it. */
  dataVersion: number;
}

const FULL_MARKUP_PERMISSION: Permission = 'judge.problem_full_markup';

const definedOnly = <Fields extends object>(fields: Fields): Fields =>
  Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as Fields;

/** The revision's view of a problem: editable source only, never rendered HTML. */
const summaryOf = (problem: Partial<Problem>) => ({
  name: problem.name,
  description: problem.description,
  translations: problem.translations?.map(
    ({ language, name, description }) => ({ language, name, description }),
  ),
  editorial: problem.solution?.content ?? null,
  timeLimit: problem.timeLimit,
  memoryLimit: problem.memoryLimit,
  partial: problem.partial,
  points: problem.points,
  groupId: problem.groupId && uuidStr(problem.groupId),
  typeIds: problem.typeIds?.map(uuidStr),
  allowedLanguages: problem.allowedLanguages?.map(uuidStr),
  authors: problem.authors?.map(uuidStr),
  curators: problem.curators?.map(uuidStr),
});

interface WrittenProblem {
  problemId: string;
  after: Partial<Problem>;
  dataVersion: number;
}

/** The imported statement, limits and data; a re-import with a tutorial keeps the editorial's publication state (it is never un-published), one without a tutorial removes the editorial. */
function statementFields(
  imported: ImportedProblem,
  before: Problem | undefined,
) {
  return {
    name: imported.name,
    description: imported.description,
    descriptionHtml: imported.descriptionHtml,
    translations: imported.translations,
    timeLimit: imported.timeLimit,
    memoryLimit: imported.memoryLimit,
    partial: imported.partial,
    data: imported.data,
    solution: imported.solution && {
      isPublic: false,
      publishOn: new Date(),
      authors: [],
      ...before?.solution,
      ...imported.solution,
    },
  };
}
type StatementFields = ReturnType<typeof statementFields>;

@Injectable()
export class PolygonImportRepository {
  constructor(
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
    @InjectModel(Revision.name) private readonly revisions: Model<Revision>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Group.name) private readonly groups: Model<Group>,
    @InjectModel(ProblemGroup.name)
    private readonly problemGroups: Model<ProblemGroup>,
    @InjectModel(ProblemType.name)
    private readonly problemTypes: Model<ProblemType>,
    @InjectModel(Language.name) private readonly languages: Model<Language>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /** Recompute-and-set after an import wrote the data files. */
  async setDataBytes(problemId: string, bytes: number): Promise<void> {
    await this.problems
      .updateOne({ _id: problemId }, { $set: { dataBytes: bytes } })
      .exec();
  }

  /** Cheap pre-check so a wrong mode fails before any file is written; `apply` checks again inside the transaction. Deliberately S: `findOne({ code })` sees deleted and tombstoned problems, so their codes stay taken. */
  async resolveTarget(job: PolygonImportJob): Promise<ImportTarget> {
    const existing = await this.problems.findOne({ code: job.code }).exec();
    this.checkTarget(job, existing);
    if (
      existing &&
      job.expectedDataVersion !== undefined &&
      existing.dataVersion !== job.expectedDataVersion
    )
      throw new PolygonImportError(
        'Test data changed since the import was queued',
      );
    return existing && { dataVersion: existing.dataVersion };
  }

  /** The editor's rule: statement text on a full-markup problem needs `judge.problem_full_markup` from the person who started the import. */
  async assertFullMarkupWriter(job: PolygonImportJob): Promise<void> {
    if (!job.isFullMarkup) return;
    const requester = await this.users.findById(job.requesterId).exec();
    const groups = requester
      ? await this.groups.find({ _id: { $in: requester.groups } }).exec()
      : [];
    if (
      !requester?.isActive ||
      (!requester.isSuperuser &&
        !permissionsOf(requester, groups).has(FULL_MARKUP_PERMISSION))
    )
      throw new PolygonImportError(
        `Full markup requires ${FULL_MARKUP_PERMISSION}`,
      );
  }

  /** One transaction: statement, translations, editorial and data are replaced, `dataVersion` is bumped with the editor's compare-and-set, and a `revisions` row records the change. Files are the caller's: nothing here touches a volume, because Mongoose may run this callback again on a transient error. */
  async apply(
    job: PolygonImportJob,
    imported: ImportedProblem,
    target: ImportTarget,
  ): Promise<AppliedImport> {
    try {
      return await this.connection.transaction((session) =>
        this.writeImportedProblem(job, imported, target, session),
      );
    } catch (error) {
      if (isDuplicateKey(error, 'code'))
        throw new PolygonImportError(
          `problem with code ${job.code} already exists`,
        );
      if (isDocumentTooLarge(error))
        throw new PolygonImportError('the test data is too large');
      throw error;
    }
  }

  private async writeImportedProblem(
    job: PolygonImportJob,
    imported: ImportedProblem,
    target: ImportTarget,
    session: ClientSession,
  ): Promise<AppliedImport> {
    const existing = await this.problems
      .findOne({ code: job.code })
      .select('+data')
      .session(session)
      .exec();
    this.checkTarget(job, existing);
    const before = existing?.toObject();
    const statement = statementFields(imported, before);
    const written =
      existing && before
        ? await this.updateIfDataVersionUnchanged(
            job,
            { problemId: existing._id, before, statement, target },
            session,
          )
        : await this.insertWithCatalogDefaults(job, statement, session);
    await this.appendImportRevision(
      job,
      { before, written, imported },
      session,
    );
    return {
      problemId: written.problemId,
      dataVersion: written.dataVersion,
      previousFiles: DATA_FILE_KINDS.flatMap(
        (kind) => before?.data?.[kind] ?? [],
      ),
    };
  }

  /** Compare-and-set on the editor's `dataVersion`: an edit that landed meanwhile fails the import instead of being overwritten. */
  private async updateIfDataVersionUnchanged(
    job: PolygonImportJob,
    {
      problemId,
      before,
      statement,
      target,
    }: {
      problemId: string;
      before: Problem;
      statement: StatementFields;
      target: ImportTarget;
    },
    session: ClientSession,
  ): Promise<WrittenProblem> {
    const catalog = definedOnly({
      groupId: job.groupId,
      typeIds: job.typeIds,
      points: job.points,
      authors: job.authors,
      curators: job.curators,
    });
    const changes = definedOnly({ ...statement, ...catalog });
    const { matchedCount } = await this.problems
      .updateOne(
        {
          _id: problemId,
          code: job.code,
          dataVersion: dataVersionIs(target?.dataVersion ?? 0),
        },
        { $set: changes, $inc: { dataVersion: 1 } },
        { session },
      )
      .exec();
    if (matchedCount !== 1)
      throw new PolygonImportError(
        'the problem changed while the package was importing, try again',
      );
    return {
      problemId,
      after: { ...before, ...changes },
      dataVersion: (target?.dataVersion ?? 0) + 1,
    };
  }

  private async insertWithCatalogDefaults(
    job: PolygonImportJob,
    statement: StatementFields,
    session: ClientSession,
  ): Promise<WrittenProblem> {
    const created = {
      ...definedOnly(statement),
      code: job.code,
      isFullMarkup: job.isFullMarkup,
      date: new Date(),
      dataVersion: 1,
      ...(await this.createCatalog(job, session)),
    };
    // `create` with a session takes an array.
    const [{ _id: problemId }] = await this.problems.create([created], {
      session,
    });
    return { problemId, after: created, dataVersion: created.dataVersion };
  }

  private async appendImportRevision(
    job: PolygonImportJob,
    {
      before,
      written,
      imported,
    }: {
      before: Problem | undefined;
      written: WrittenProblem;
      imported: ImportedProblem;
    },
    session: ClientSession,
  ): Promise<void> {
    await this.revisions.create(
      [
        {
          entity: 'problem',
          entityId: written.problemId,
          action: 'import',
          userId: job.requesterId,
          changes: {
            ...fieldDiff(summaryOf(before ?? {}), summaryOf(written.after)),
            ...dataChanges(before?.data ?? emptyProblemData(), imported.data),
          },
          comment: `Imported from a Polygon package (${job.mode})`,
        },
      ],
      { session },
    );
  }

  /** Legacy defaults for a new problem: the oldest group and type (UUIDv7 ids sort by creation time), every language offered on problems, the lowest point value. */
  private async createCatalog(job: PolygonImportJob, session: ClientSession) {
    const oldest = async (
      model: Model<ProblemGroup | ProblemType>,
      what: string,
    ) => {
      const row = await model
        .findOne()
        .sort({ _id: 1 })
        .session(session)
        .exec();
      if (!row) throw new PolygonImportError(`no problem ${what} exists`);
      return row._id;
    };
    return {
      groupId: job.groupId ?? (await oldest(this.problemGroups, 'group')),
      typeIds: job.typeIds ?? [await oldest(this.problemTypes, 'type')],
      allowedLanguages: (
        await this.languages
          .find({ includeInProblem: true }, { _id: 1 })
          .session(session)
          .exec()
      ).map((language) => language._id),
      points: job.points ?? PROBLEM_LIMITS.points.min,
      authors: job.authors ?? [],
      curators: job.curators ?? [],
    };
  }

  private checkTarget(
    job: PolygonImportJob,
    existing: {
      isFullMarkup: boolean;
      isManuallyManaged: boolean;
      mirrorOf: string | null;
      deletedAt?: Date | null;
    } | null,
  ): void {
    if (existing?.deletedAt)
      throw new PolygonImportError(`problem with code ${job.code} is deleted`);
    if (job.mode === 'create' && existing)
      throw new PolygonImportError(
        `problem with code ${job.code} already exists`,
      );
    if (job.mode === 'update' && !existing)
      throw new PolygonImportError(`problem with code ${job.code} not found`);
    if (!existing) return;
    if (existing.mirrorOf !== null)
      throw new PolygonImportError(
        'a mirror problem takes its test data from the source problem',
      );
    if (existing.isManuallyManaged)
      throw new PolygonImportError('the problem is manually managed');
    if (existing.isFullMarkup !== job.isFullMarkup)
      throw new PolygonImportError(
        'the problem markup mode changed since the import was queued',
      );
  }
}
