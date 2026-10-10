import { Controller, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { ApiFileUpload } from '@libs/common';
import { CurrentAuth, RequirePermission } from '@libs/auth';
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
   * Needs `judge.upload_file_statement` and edit rights on the problem. Send one
   * multipart `file`, a PDF of up to 5 MiB (400 `statement_not_pdf` otherwise).
   * It replaces the previous PDF statement and returns its `url`. Cached
   * packages of the problem are dropped. Shares the upload budget of 30 per hour
   * per user.
   */
  @RequirePermission('judge.upload_file_statement')
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
   * Needs `judge.upload_problem_material` and edit rights on the problem. Send
   * one multipart `file` of up to 20 MiB with an allowed extension (archives,
   * documents, sources, plain images and data files; 400
   * `material_type_not_allowed` otherwise). It replaces the previous material
   * and returns its `url`. Shares the upload budget of 30 per hour per user.
   */
  @RequirePermission('judge.upload_problem_material')
  @ApiFileUpload()
  @Post(':code/material')
  uploadMaterial(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
    @Req() request: FastifyRequest,
  ): Promise<UploadedFileResponse> {
    return this.uploads.uploadMaterial(auth, code, request);
  }
}
