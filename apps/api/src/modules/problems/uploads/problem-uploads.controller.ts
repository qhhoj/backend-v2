import { Controller, Delete, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { ApiFileUpload } from '@libs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ProblemCodeParamDto } from '../core/dto/problem-params.dto';
import { UploadedFileResponse } from './dto/uploaded-file.response';
import { ProblemUploadsService } from './problem-uploads.service';

@ApiTags('Problem editing')
@Controller('api/internal/problems')
export class ProblemUploadsController {
  constructor(private readonly uploads: ProblemUploadsService) {}

  /**
   * Upload an image for use in statements
   *
   * @remarks
   * Allowed for staff and users with `judge.can_upload_image`. Send one
   * multipart `file` of up to 5 MiB; the type is detected from the content and
   * only JPG, PNG, GIF and SVG are accepted (400 `image_type_not_allowed`). SVGs
   * are sanitized and must stay under 512 KiB (400 `svg_too_large`). Returns the
   * public `url` to reference from markdown. Shares the upload budget of 30 per
   * hour per user (429 `rate_limited`).
   */
  @ApiFileUpload()
  @Post('uploads/image')
  uploadImage(
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<UploadedFileResponse> {
    return this.uploads.uploadImage(auth, request);
  }

  /**
   * Upload the PDF statement of a problem
   *
   * @remarks
   * Needs edit rights on the problem and `judge.upload_file_statement`; an
   * administrator who may create problems for every organization of an
   * organization-private problem needs no permission. Send one multipart
   * `file`, a PDF of up to 5 MiB (400 `statement_not_pdf` otherwise). It
   * replaces the previous PDF statement and returns its `url`. On an
   * organization problem the file counts against the organization's storage
   * (403 `quota_exceeded`; a replaced file's bytes are given back). Cached
   * packages of the problem are dropped. Shares the upload budget of 30 per
   * hour per user.
   */
  @ApiFileUpload()
  @Post(':code/statement')
  uploadStatement(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
    @Req() request: FastifyRequest,
  ): Promise<UploadedFileResponse> {
    return this.uploads.uploadStatement(auth, code, request);
  }

  /**
   * Upload the downloadable material of a problem
   *
   * @remarks
   * Needs edit rights on the problem and `judge.upload_problem_material`; an
   * administrator who may create problems for every organization of an
   * organization-private problem needs no permission. Send one multipart
   * `file` of up to 20 MiB with an extension listed in the meta's
   * `materialExtensions` (400 `material_type_not_allowed` otherwise). It
   * replaces the previous material and returns its `url`. On an organization
   * problem the file counts against the organization's storage (403
   * `quota_exceeded`). Shares the upload budget of 30 per hour per user.
   */
  @ApiFileUpload()
  @Post(':code/material')
  uploadMaterial(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
    @Req() request: FastifyRequest,
  ): Promise<UploadedFileResponse> {
    return this.uploads.uploadMaterial(auth, code, request);
  }

  /**
   * Remove the PDF statement of a problem
   *
   * @remarks
   * The rights of the upload. Does nothing when there is none; on an
   * organization problem its bytes leave the organization's storage.
   */
  @Delete(':code/statement')
  @HttpCode(204)
  removeStatement(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
  ): Promise<void> {
    return this.uploads.removeFile(auth, code, 'pdfStatementUrl');
  }

  /**
   * Remove the downloadable material of a problem
   *
   * @remarks
   * The rights of the upload. Does nothing when there is none; on an
   * organization problem its bytes leave the organization's storage.
   */
  @Delete(':code/material')
  @HttpCode(204)
  removeMaterial(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
  ): Promise<void> {
    return this.uploads.removeFile(auth, code, 'materialUrl');
  }
}
