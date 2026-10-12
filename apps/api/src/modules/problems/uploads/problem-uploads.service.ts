import { Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { hasPermission } from '@libs/auth';
import type { AuthContext, Permission, Principal } from '@libs/auth';
import { AppError, RateLimitService, StorageService } from '@libs/common';
import { newId } from '@libs/database';
import {
  extensionOf,
  IMAGE_MAX_BYTES,
  isPdf,
  isSvgWithinLimits,
  MATERIAL_EXTENSIONS,
  MATERIAL_MAX_BYTES,
  PackageCacheService,
  safeFileName,
  sniffImage,
  STATEMENT_PDF_MAX_BYTES,
  SVG_MAX_BYTES,
} from '@libs/problems';
import { sanitizeSvg } from '@libs/render';
import { readMultipartFile, rejectFile } from '../core/multipart';
import type { UploadedFile } from '../core/multipart';
import { OrganizationProblemRules } from '../editing/organization-problem-rules.service';
import { ProblemEditPolicyService } from '../editing/problem-edit-policy.service';
import { ProblemEvents } from '../core/problem.events';
import { ProblemsRepository } from '../core/problems.repository';
import type { ProblemDocument } from '../core/problems.repository';
import { UPLOAD_LIMIT, UPLOAD_WINDOW_SECONDS } from '../core/rate-limits';
import { RevisionsRepository } from '../core/revisions.repository';
import { ProblemStorageQuota } from '../quota/problem-storage-quota.service';

/** The two problem files kept in media storage: their size field (the storage meter), the global permission a site problem needs, and the media folder. */
const PROBLEM_FILES = {
  pdfStatementUrl: {
    bytesField: 'pdfStatementBytes',
    permission: 'judge.upload_file_statement',
    folder: 'pdf',
  },
  materialUrl: {
    bytesField: 'materialBytes',
    permission: 'judge.upload_problem_material',
    folder: 'materials',
  },
} as const satisfies Record<
  string,
  { bytesField: keyof ProblemDocument; permission: Permission; folder: string }
>;
export type ProblemFileField = keyof typeof PROBLEM_FILES;

const ALLOWED_MATERIAL_EXTENSIONS: ReadonlySet<string> = new Set(
  MATERIAL_EXTENSIONS,
);

function sanitizedSvg(content: Buffer): Buffer {
  if (content.length > SVG_MAX_BYTES)
    throw rejectFile('The SVG is too large or too complex.', 'svg_too_large');
  const svg = content.toString('utf8');
  if (!isSvgWithinLimits(svg))
    throw rejectFile('The SVG is too large or too complex.', 'svg_too_large');
  return Buffer.from(sanitizeSvg(svg), 'utf8');
}

@Injectable()
export class ProblemUploadsService {
  constructor(
    private readonly storage: StorageService,
    private readonly rateLimit: RateLimitService,
    private readonly policy: ProblemEditPolicyService,
    private readonly repository: ProblemsRepository,
    private readonly revisions: RevisionsRepository,
    private readonly events: ProblemEvents,
    private readonly packages: PackageCacheService,
    private readonly organizationRules: OrganizationProblemRules,
    private readonly quota: ProblemStorageQuota,
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
      throw rejectFile(
        'Only JPG, PNG, GIF and SVG images are accepted.',
        'image_type_not_allowed',
      );
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
    const problem = await this.uploadableProblem(
      auth.principal,
      code,
      'pdfStatementUrl',
    );
    const { content } = await this.readUpload(
      auth,
      request,
      STATEMENT_PDF_MAX_BYTES,
    );
    if (!isPdf(content))
      throw rejectFile(
        'The statement must be a PDF file.',
        'statement_not_pdf',
      );
    const url = await this.replaceFile(auth, problem, {
      field: 'pdfStatementUrl',
      relativePath: `pdf/${newId()}.pdf`,
      content,
    });
    return { url };
  }

  async uploadMaterial(
    auth: AuthContext,
    code: string,
    request: FastifyRequest,
  ): Promise<{ url: string }> {
    const problem = await this.uploadableProblem(
      auth.principal,
      code,
      'materialUrl',
    );
    const { filename, content } = await this.readUpload(
      auth,
      request,
      MATERIAL_MAX_BYTES,
    );
    const name = safeFileName(filename);
    if (!ALLOWED_MATERIAL_EXTENSIONS.has(extensionOf(name)))
      throw rejectFile(
        'This file type is not allowed as problem material.',
        'material_type_not_allowed',
      );
    const url = await this.replaceFile(auth, problem, {
      field: 'materialUrl',
      relativePath: `materials/${problem._id}/${name}`,
      content,
    });
    this.events.emit('statementChanged', problem._id);
    return { url };
  }

  /** Removes the PDF statement or the material; nothing to do when there is none. The freed bytes leave the organization's storage at once. */
  async removeFile(
    auth: AuthContext,
    code: string,
    field: ProblemFileField,
  ): Promise<void> {
    const problem = await this.uploadableProblem(auth.principal, code, field);
    if (problem[field] === null) return;
    await this.recordChange(auth, problem._id, {
      field,
      before: problem[field],
      after: null,
      bytes: 0,
    });
    await this.packages.deleteAll(problem.code);
    await this.deleteIfUnreferenced(problem, field, null);
    if (field === 'materialUrl')
      this.events.emit('statementChanged', problem._id);
  }

  /** Edit rights, then the field's global permission, waived for an administrator of the problem's organizations (organization problems only). Checked before the upload budget is spent. */
  private async uploadableProblem(
    principal: Principal,
    code: string,
    field: ProblemFileField,
  ): Promise<ProblemDocument> {
    const problem = await this.policy.editableProblem(principal, code);
    const { permission } = PROBLEM_FILES[field];
    if (
      !hasPermission(principal, permission) &&
      !(await this.organizationRules.managesAsOrganization(principal, problem))
    )
      throw new AppError(
        'forbidden',
        403,
        `Changing this file requires ${permission}`,
      );
    return problem;
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

  /** Checks the organization's storage, saves the new file and records it; the previous file is removed afterwards, the new one if recording fails. */
  private async replaceFile(
    auth: AuthContext,
    problem: ProblemDocument,
    upload: {
      field: ProblemFileField;
      relativePath: string;
      content: Buffer;
    },
  ): Promise<string> {
    const { field, relativePath, content } = upload;
    const organizationId = this.quota.organizationOf(auth.principal, problem);
    await this.quota.assertFits(organizationId, {
      addedBytes: content.length - problem[PROBLEM_FILES[field].bytesField],
    });
    const url = await this.storage.save(relativePath, content);
    try {
      await this.recordChange(auth, problem._id, {
        field,
        before: problem[field],
        after: url,
        bytes: content.length,
      });
    } catch (error) {
      await this.storage.delete(relativePath);
      throw error;
    }
    // The content key cannot see a same-named material; drop the problem's cached packages (a build already running can still write one stale zip under the old key, accepted).
    await this.packages.deleteAll(problem.code);
    await this.deleteIfUnreferenced(problem, field, relativePath);
    await this.quota.afterWrite(organizationId);
    return url;
  }

  /** Deletes the problem's previous file unless it is the one just written (`keptPath`) or a clone still points at it. */
  private async deleteIfUnreferenced(
    problem: ProblemDocument,
    field: ProblemFileField,
    keptPath: string | null,
  ): Promise<void> {
    const previousUrl = problem[field];
    const previous = this.storage.relativePathOf(
      previousUrl,
      PROBLEM_FILES[field].folder,
    );
    if (
      previousUrl &&
      previous &&
      previous !== keptPath &&
      !(await this.repository.countOtherReferences(
        field,
        previousUrl,
        problem._id,
      ))
    )
      await this.storage.delete(previous).catch(() => undefined);
  }

  private async recordChange(
    auth: AuthContext,
    problemId: string,
    change: {
      field: ProblemFileField;
      before: string | null;
      after: string | null;
      bytes: number;
    },
  ): Promise<void> {
    const { field, before, after, bytes } = change;
    await this.repository.update(problemId, {
      [field]: after,
      [PROBLEM_FILES[field].bytesField]: bytes,
    });
    await this.revisions.append({
      entity: 'problem',
      entityId: problemId,
      action: 'upload',
      userId: auth.principal.userId,
      changes: { [field]: { before, after } },
      comment: `${field} ${after === null ? 'removed' : 'uploaded'}`,
    });
  }
}
