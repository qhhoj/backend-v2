import { ApiTags } from '@nestjs/swagger';
import { Controller, Get } from '@nestjs/common';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import type { HomeResponse } from './dto/home.response';
import { HomeService } from './home.service';

@Public()
@ApiTags('Home & site')
@Controller('api/internal/home')
export class HomeController {
  constructor(private readonly home: HomeService) {}

  /**
   * Get the home page widgets
   *
   * @remarks
   * Public. Returns the side widgets of the home page: the newest comments the viewer may read, the 7 newest problems, the top 5 users by performance points and by contribution points, and site-wide counts. The anonymous comment slice is cached for 60 seconds. Running and upcoming contests come from the contests list.
   */
  @Get()
  get(@CurrentAuth() auth: AuthContext | undefined): Promise<HomeResponse> {
    return this.home.home(optionalPrincipal(auth));
  }
}
