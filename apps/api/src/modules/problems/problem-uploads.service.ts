import { Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { hasPermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { AppError, RateLimitService, StorageService } from '@libs/common';
import { newId } from '@libs/database';
import { sanitizeSvg } from '@libs/render';
import { basename } from 'node:path';
import {
  isPdf,
  isSvgWithinLimits,
  sniffImage,
  SVG_MAX_BYTES,
} from './file-sniff';
import { ProblemEditingService } from './problem-editing.service';
import { ProblemsRepository } from './problems.repository';
import type { ProblemDocument } from './problems.repository';
import { UPLOAD_LIMIT, UPLOAD_WINDOW_SECONDS } from './rate-limits';
import { RevisionsRepository } from './revisions.repository';

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const STATEMENT_MAX_BYTES = 5 * 1024 * 1024;
export const MATERIAL_MAX_BYTES = 20 * 1024 * 1024;
const FILE_NAME_MAX_LENGTH = 100;

interface Upload {
  filename: string;
  content: Buffer;
}

/** Client names never reach the filesystem as sent: allow-listed characters only, no `..`, no leading dot, capped. */
export const safeFileName = (name: string): string =>
  basename(name)
    .replace(/\s+/g, '_')
    .replace(/[^\w.-]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+/, '')
    .slice(0, FILE_NAME_MAX_LENGTH) || 'material';

const rejectFile = (message: string) =>
  new AppError('validation_failed', 400, message, { file: [message] });

function sanitizedSvg(content: Buffer): Buffer {
  const svg = content.toString('utf8');
  if (content.length > SVG_MAX_BYTES || !isSvgWithinLimits(svg))
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
    const url = await this.replaceFile(
      auth,
      problem,
      'materialUrl',
      `materials/${problem.code}/${safeFileName(filename)}`,
      content,
    );
    return { url };
  }

  /** Reserves upload budget (never released), then streams the single multipart file under the size limit; exceeding it is 413. */
  private async readUpload(
    auth: AuthContext,
    request: FastifyRequest,
    maxBytes: number,
  ): Promise<Upload> {
    await this.rateLimit.reserve(
      [`upload:user:${auth.principal.userId}`],
      UPLOAD_LIMIT,
      UPLOAD_WINDOW_SECONDS,
    );
    if (!request.isMultipart()) throw rejectFile('A file is required.');
    const file = await request.file({ limits: { fileSize: maxBytes } });
    if (!file) throw rejectFile('A file is required.');
    try {
      return { filename: file.filename, content: await file.toBuffer() };
    } catch (error) {
      if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE')
        throw new AppError(
          'file_too_large',
          413,
          `The file exceeds ${maxBytes} bytes`,
        );
      throw error;
    }
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
    const previous = this.storage.relativePathOf(
      problem[field],
      relativePath.slice(0, relativePath.lastIndexOf('/') + 1),
    );
    if (previous && previous !== relativePath)
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
