import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AppError, isDuplicateKey } from '@libs/common';
import { compareLanguages, Language } from '@libs/database';
import type { Model } from 'mongoose';
import { LanguageUsageRepository } from './language-usage.repository';
import { LanguagesQuerier } from './languages.querier';
import type {
  CreateLanguageDto,
  UpdateLanguageDto,
} from './dto/language-admin.dto';
import {
  LanguageAdminResponse,
  LanguageUsageResponse,
} from './dto/language-admin.response';

const notFound = () => new AppError('not_found', 404, 'No such language');
const RECENT_DAYS = 30;
const DAY_MS = 86_400_000;

/** Staff list, create and update for the languages catalog. Every write resyncs this process's querier at once; other processes follow the change stream. */
@Injectable()
export class LanguagesAdminService {
  constructor(
    @InjectModel(Language.name) private readonly languages: Model<Language>,
    private readonly usageCounts: LanguageUsageRepository,
    private readonly querier: LanguagesQuerier,
  ) {}

  async list(): Promise<LanguageAdminResponse[]> {
    const rows = await this.languages.find().lean<Language[]>().exec();
    return rows
      .sort(compareLanguages)
      .map((row) => LanguageAdminResponse.from(row));
  }

  /** Problems that allow each language and its submissions over the last 30 days; languages nothing uses are absent. */
  async usage(now = new Date()): Promise<LanguageUsageResponse[]> {
    const since = new Date(now.getTime() - RECENT_DAYS * DAY_MS);
    const [problems, submissions] = await Promise.all([
      this.usageCounts.problemsPerLanguage(),
      this.usageCounts.submissionsPerLanguageSince(since),
    ]);
    return [...new Set([...problems.keys(), ...submissions.keys()])].map(
      (languageId) => ({
        languageId,
        problems: problems.get(languageId) ?? 0,
        recentSubmissions: submissions.get(languageId) ?? 0,
      }),
    );
  }

  async create(dto: CreateLanguageDto): Promise<LanguageAdminResponse> {
    const language = await this.write(() => this.languages.create(dto));
    await this.querier.resync();
    return LanguageAdminResponse.from(language.toObject());
  }

  async update(
    id: string,
    dto: UpdateLanguageDto,
  ): Promise<LanguageAdminResponse> {
    const language = await this.write(() =>
      this.languages
        .findByIdAndUpdate(
          id,
          { $set: dto },
          { new: true, runValidators: true },
        )
        .lean<Language>()
        .exec(),
    );
    if (!language) throw notFound();
    await this.querier.resync();
    return LanguageAdminResponse.from(language);
  }

  private async write<Result>(action: () => Promise<Result>): Promise<Result> {
    try {
      return await action();
    } catch (error) {
      if (isDuplicateKey(error, 'key'))
        throw new AppError('conflict', 409, 'A language with this key exists', {
          key: ['This key is taken.'],
        });
      throw error;
    }
  }
}
