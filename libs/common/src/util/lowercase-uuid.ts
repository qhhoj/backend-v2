import { Transform } from 'class-transformer';

const lowercase = (value: unknown): unknown =>
  typeof value === 'string' ? value.toLowerCase() : value;

/** Lowercases a UUID string, or each string of an array; anything else passes through for the validator to refuse. */
export const lowercaseUuids = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value) ? value.map(lowercase) : lowercase(value);

/** Pairs with every `@IsUUID`: ids are compared as the lowercase strings `uuidStr` gives, so `ABC…` must arrive as `abc…`. */
export const LowercaseUuid = () => Transform(lowercaseUuids);
