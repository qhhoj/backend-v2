import { invalidField, MAX_UPLOAD_BYTES } from '@libs/common';
import { LANGUAGE_EXTENSION_PATTERN } from '@libs/database';
import type { Language } from '@libs/database';
import { extensionOf, ZipArchive, ZipError } from '@libs/problems';
import { tooLarge } from '../../problems/core/multipart';
import type { UploadedFile } from '../../problems/core/multipart';

/** Legacy `SUBMISSION_FILE_UPLOAD_MEDIA_DIR`: uploads live at `<dir>/<problem code>/<user id>/<random>.<extension>` under the media root. */
export const SUBMISSION_FILE_DIR = 'submission_file';
const SCRATCH_KEY = 'SCRATCH';
const SCRATCH_PROJECT = 'project.json';
const BYTES_PER_MB = 1024 * 1024;

type FileLanguage = Pick<
  Language,
  'key' | 'extension' | 'fileOnly' | 'fileSizeLimit'
>;

/** Legacy `ProblemSubmitForm.check_submission`: the language's stored extension must match `LANGUAGE_EXTENSION_PATTERN` (rows written around the schema), the file's extension (any case) must be it, the file at most `fileSizeLimit` MB (0 = uploads off; clamped to the upload cap); a Scratch `.sb3` is reduced to its `project.json`. Returns the bytes to store. */
export async function submittedFile(
  language: FileLanguage,
  { filename, content }: UploadedFile,
): Promise<Buffer> {
  if (!LANGUAGE_EXTENSION_PATTERN.test(language.extension))
    throw invalidField(
      'language',
      'This language has no usable file extension.',
      'language_extension_invalid',
    );
  if (language.fileSizeLimit <= 0)
    throw invalidField(
      'language',
      'File uploads are turned off for this language.',
      'file_upload_disabled',
    );
  const maxBytes = Math.min(
    language.fileSizeLimit * BYTES_PER_MB,
    MAX_UPLOAD_BYTES,
  );
  if (extensionOf(filename) !== language.extension)
    throw invalidField(
      'file',
      `This language takes a .${language.extension} file.`,
      'file_wrong_extension',
    );
  if (content.length > maxBytes) throw tooLarge(maxBytes);
  return language.key === SCRATCH_KEY
    ? scratchProject(content, maxBytes)
    : content;
}

/** The `project.json` of an `.sb3` zip, read under `ZIP_LIMITS` (no traversal, symlinks or lying sizes) and the language cap. */
async function scratchProject(
  content: Buffer,
  maxBytes: number,
): Promise<Buffer> {
  const refuse = (message: string) =>
    invalidField('file', message, 'scratch_project_invalid');
  let archive: ZipArchive | undefined;
  try {
    archive = await ZipArchive.fromBuffer(content);
    if (!archive.has(SCRATCH_PROJECT))
      throw refuse(`The Scratch file has no ${SCRATCH_PROJECT}.`);
    if (archive.sizeOf(SCRATCH_PROJECT) > maxBytes) throw tooLarge(maxBytes);
    return await archive.read(SCRATCH_PROJECT);
  } catch (error) {
    throw error instanceof ZipError ? refuse(error.message) : error;
  } finally {
    await archive?.close();
  }
}
