import { AppError } from '@libs/common';
import { PolygonApiError } from '@libs/problems';
import type { PolygonErrorCode } from '@libs/problems';

/** Polygon is the upstream: its refusals are gateway errors, not the caller's. */
const STATUS: Record<PolygonErrorCode, number> = {
  polygon_not_connected: 409,
  polygon_unauthorized: 502,
  polygon_clock_skew: 502,
  polygon_failed: 502,
  polygon_unavailable: 503,
  polygon_package_too_large: 413,
};

/** Runs a Polygon call and answers its failure with the error code as the HTTP error code. */
export async function askPolygon<Result>(
  call: () => Promise<Result>,
): Promise<Result> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof PolygonApiError)
      throw new AppError(error.code, STATUS[error.code], error.message);
    throw error;
  }
}

/** `reason` names Polygon's newest package and its state (see `packageNotReadyReason`). */
export const packageNotReady = (polygonId: number, reason: string) =>
  new AppError(
    'polygon_package_not_ready',
    409,
    `Polygon problem ${polygonId} has no READY full package: ${reason}. Build a full package (with Linux tests) on Polygon first`,
  );
