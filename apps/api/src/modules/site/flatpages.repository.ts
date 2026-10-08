import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Flatpage } from '@libs/database';
import type { Model } from 'mongoose';

@Injectable()
export class FlatpagesRepository {
  constructor(
    @InjectModel(Flatpage.name) private readonly flatpages: Model<Flatpage>,
  ) {}

  /** Through the unique `{url}` index; the markdown source is not loaded. */
  findByUrl(url: string): Promise<Flatpage | null> {
    return this.flatpages
      .findOne({ url }, { content: 0 })
      .lean<Flatpage>()
      .exec();
  }
}
