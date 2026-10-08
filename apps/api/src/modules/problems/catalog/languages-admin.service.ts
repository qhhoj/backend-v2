import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AppError, isDuplicateKey } from '@libs/common';
import { Language } from '@libs/database';
import type { Model } from 'mongoose';
import { LanguagesQuerier } from './languages.querier';
import type {
  CreateLanguageDto,
  UpdateLanguageDto,
} from './dto/language-admin.dto';
import { LanguageAdminResponse } from './dto/language-admin.response';

const notFound = () => new AppError('not_found', 404, 'No such language');

/** Staff list, create and update for the languages catalog. Every write resyncs this process's querier at once; other processes follow the change stream. */
@Injectable()
export class LanguagesAdminService {
  constructor(
    @InjectModel(Language.name) private readonly languages: Model<Language>,
    private readonly querier: LanguagesQuerier,
  ) {}

  async list(): Promise<LanguageAdminResponse[]> {
    const rows = await this.languages
      .find()
      .collation({ locale: 'en' })
      .sort({ name: 1 })
      .lean<Language[]>()
      .exec();
    return rows.map((row) => LanguageAdminResponse.from(row));
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
