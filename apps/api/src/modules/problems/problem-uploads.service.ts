import { Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { hasPermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { AppError, RateLimitService, StorageService } from '@libs/common';
import { newId } from '@libs/database';
import {
  extensionOf,
  safeFileName,
  isPdf,
  isSvgWithinLimits,
  sniffImage,
  SVG_MAX_BYTES,
} from '@libs/problems';
import { sanitizeSvg } from '@libs/render';
import { readMultipartFile, rejectFile } from './multipart';
import type { UploadedFile } from './multipart';
import { ProblemEditingService } from './problem-editing.service';
import { ProblemsRepository } from './problems.repository';
import type { ProblemDocument } from './problems.repository';
import { UPLOAD_LIMIT, UPLOAD_WINDOW_SECONDS } from './rate-limits';
import { RevisionsRepository } from './revisions.repository';

const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const STATEMENT_MAX_BYTES = 5 * 1024 * 1024;
const MATERIAL_MAX_BYTES = 20 * 1024 * 1024;
/** Archives, documents, test data, sources and plain images; never anything a browser would run or render as markup. */
const MATERIAL_EXTENSIONS: ReadonlySet<string> = new Set(
  (
    'zip 7z rar tar gz tgz bz2 xz pdf txt md csv in out ans ' +
    'c cpp cc h hpp py java pas kt rs go doc docx xls xlsx ppt pptx odt ' +
    'png jpg jpeg gif'
  ).split(' '),
);

function sanitizedSvg(content: Buffer): Buffer {
  if (content.length > SVG_MAX_BYTES)
    throw rejectFile('The SVG is too large or too complex.');
  const svg = content.toString('utf8');
  if (!isSvgWithinLimits(svg))
    throw rejectFile('The SVG is too large or too complex.');
  return Buffer.from(sanitizeSvg(svg), 'utf8');
}

@Injectable()
export class ProblemUploadsService {
  constructor(
    private readonly storage: StorageService,
    private readonly rateLimit: RateLimitService,
    private readonly editing: ProblemEditingService,
    private readonly repository: ProblemsRepository,
    private readonly revisions: RevisionsRepository,
  ) {}

  async uploadImage(
    auth: AuthContext,
    request: FastifyRequest,
  ): Promise<{ url: string }> {
    const { principal } = auth;
    if (
      !principal.isStaff &&
      !hasPermission(principal, 'judge.can_upload_image')
    )
      throw new AppError('forbidden', 403, 'Permission denied');
    const { content } = await this.readUpload(auth, request, IMAGE_MAX_BYTES);
    const kind = sniffImage(content);
    if (!kind)
      throw rejectFile('Only JPG, PNG, GIF and SVG images are accepted.');
    const stored = kind === 'svg' ? sanitizedSvg(content) : content;
    return {
      url: await this.storage.save(`images/${newId()}.${kind}`, stored),
    };
  }

  async uploadStatement(
    auth: AuthContext,
    code: string,
    request: FastifyRequest,
  ): Promise<{ url: string }> {
    const problem = await this.editing.editableProblem(auth.principal, code);
    const { content } = await this.readUpload(
      auth,
      request,
      STATEMENT_MAX_BYTES,
    );
    if (!isPdf(content)) throw rejectFile('The statement must be a PDF file.');
    const url = await this.replaceFile(
      auth,
      problem,
      'pdfStatementUrl',
      `pdf/${newId()}.pdf`,
      content,
    );
    return { url };
  }

  async uploadMaterial(
    auth: AuthContext,
    code: string,
    request: FastifyRequest,
  ): Promise<{ url: string }> {
    const problem = await this.editing.editableProblem(auth.principal, code);
    const { filename, content } = await this.readUpload(
      auth,
      request,
      MATERIAL_MAX_BYTES,
    );
    const name = safeFileName(filename);
    if (!MATERIAL_EXTENSIONS.has(extensionOf(name)))
      throw rejectFile('This file type is not allowed as problem material.');
    const url = await this.replaceFile(
      auth,
      problem,
      'materialUrl',
      `materials/${problem._id}/${name}`,
      content,
    );
    return { url };
  }

  /** Reserves upload budget (never released), then reads the single multipart file under the size limit. */
  private async readUpload(
    auth: AuthContext,
    request: FastifyRequest,
    maxBytes: number,
  ): Promise<UploadedFile> {
    await this.rateLimit.reserve(
      [`upload:user:${auth.principal.userId}`],
      UPLOAD_LIMIT,
      UPLOAD_WINDOW_SECONDS,
    );
    return readMultipartFile(request, maxBytes);
  }

  /** Saves the new file and records it; the previous file is removed afterwards, the new one if recording fails. */
  private async replaceFile(
    auth: AuthContext,
    problem: ProblemDocument,
    field: 'pdfStatementUrl' | 'materialUrl',
    relativePath: string,
    content: Buffer,
  ): Promise<string> {
    const url = await this.storage.save(relativePath, content);
    try {
      await this.recordUpload(auth, problem._id, field, problem[field], url);
    } catch (error) {
      await this.storage.delete(relativePath);
      throw error;
    }
    const previousUrl = problem[field];
    const previous = this.storage.relativePathOf(
      previousUrl,
      field === 'pdfStatementUrl' ? 'pdf' : 'materials',
    );
    if (
      previousUrl &&
      previous &&
      previous !== relativePath &&
      !(await this.repository.countOtherReferences(
        field,
        previousUrl,
        problem._id,
      ))
    )
      await this.storage.delete(previous).catch(() => undefined);
    return url;
  }

  private async recordUpload(
    auth: AuthContext,
    problemId: string,
    field: 'pdfStatementUrl' | 'materialUrl',
    before: string | null,
    url: string,
  ): Promise<void> {
    await this.repository.update(problemId, { [field]: url });
    await this.revisions.append({
      entity: 'problem',
      entityId: problemId,
      action: 'upload',
      userId: auth.principal.userId,
      changes: { [field]: { before, after: url } },
      comment: `${field} uploaded`,
    });
  }
}
