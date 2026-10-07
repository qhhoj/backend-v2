import { Controller, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ProblemCodeParamDto } from '../core/dto/problem-params.dto';
import { ProblemUploadsService } from './problem-uploads.service';

@Controller('api/internal/problems')
export class ProblemUploadsController {
  constructor(private readonly uploads: ProblemUploadsService) {}

  @Post('uploads/image')
  uploadImage(
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<{ url: string }> {
    return this.uploads.uploadImage(auth, request);
  }

  @RequirePermission('judge.upload_file_statement')
  @Post(':code/statement')
  uploadStatement(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
    @Req() request: FastifyRequest,
  ): Promise<{ url: string }> {
    return this.uploads.uploadStatement(auth, code, request);
  }

  @RequirePermission('judge.upload_problem_material')
  @Post(':code/material')
  uploadMaterial(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
    @Req() request: FastifyRequest,
  ): Promise<{ url: string }> {
    return this.uploads.uploadMaterial(auth, code, request);
  }
}
