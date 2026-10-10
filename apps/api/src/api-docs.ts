import { NestFastifyApplication } from '@nestjs/platform-fastify';
import scalarApiReference from '@scalar/fastify-api-reference';
import { OPENAPI_PATH } from './openapi';

/**
 * Serves a Scalar reference at `GET /api/docs/` (`/api/docs` redirects) rendering the OpenAPI document.
 * The bundle comes from the api itself (no third-party script or font) and the document URL is relative
 * to the host, so the page works on every host nginx serves the api on.
 */
export function setupApiDocs(app: NestFastifyApplication): void {
  void app
    .getHttpAdapter()
    .getInstance()
    .register(scalarApiReference, {
      routePrefix: '/api/docs',
      configuration: {
        url: OPENAPI_PATH,
        pageTitle: 'QHHOJ API',
        withDefaultFonts: false,
      },
    });
}
