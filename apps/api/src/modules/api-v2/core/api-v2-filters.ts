import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { toArray } from '../../problems/core/dto/transforms';

export const API_V2_MAX_PAGE = 10000;
export const MAX_FILTER_VALUES = 100;
const MAX_FILTER_LENGTH = 100;
const NO_NUL = /^[^\0]*$/;

/** Every repeatable filter is a bounded array of NUL-free strings, never an object (no Mongo operators). */
export const FilterStrings = () => (target: object, key: string) => {
  Transform(toArray)(target, key);
  ArrayMaxSize(MAX_FILTER_VALUES)(target, key);
  IsString({ each: true })(target, key);
  MaxLength(MAX_FILTER_LENGTH, { each: true })(target, key);
  Matches(NO_NUL, { each: true })(target, key);
  IsOptional()(target, key);
};
