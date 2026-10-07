import { Controller, Get } from '@nestjs/common';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import type { HomeResponse } from './dto/home.response';
import { HomeService } from './home.service';

@Public()
@Controller('api/internal/home')
export class HomeController {
  constructor(private readonly home: HomeService) {}

  @Get()
  get(@CurrentAuth() auth: AuthContext | undefined): Promise<HomeResponse> {
    return this.home.home(optionalPrincipal(auth));
  }
}
