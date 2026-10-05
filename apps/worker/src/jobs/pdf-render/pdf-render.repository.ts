import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Language, Problem, uuidStr } from '@libs/database';
import type { Model } from 'mongoose';

@Injectable()
export class PdfRenderRepository {
  constructor(
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
    @InjectModel(Language.name) private readonly languages: Model<Language>,
  ) {}

  findByCode(code: string): Promise<Problem | null> {
    return this.problems.findOne({ code }).lean<Problem>().exec();
  }

  async languageNames(ids: string[]): Promise<Map<string, string>> {
    const languages = await this.languages
      .find({ _id: { $in: ids } }, { name: 1 })
      .lean()
      .exec();
    return new Map(
      languages.map((language) => [uuidStr(language._id), language.name]),
    );
  }
}
