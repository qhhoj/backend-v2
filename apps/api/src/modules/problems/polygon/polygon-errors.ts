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
    `Polygon problem ${polygonId} has no READY package: ${reason}. Build a package on Polygon first`,
  );

export const linkInvalid = () =>
  new AppError(
    'polygon_link_invalid',
    400,
    'Not a Polygon problem link: paste the address of the problem page, https://polygon.codeforces.com/p…/owner/name',
  );

/** One answer for "not shared with the account" and "wrong link token", so a guessed link learns nothing. */
export const linkRefused = () =>
  new AppError(
    'polygon_link_refused',
    404,
    'The QHHOJ Polygon account cannot open this link: copy it again from the problem page on Polygon, and give the account READ access to the problem',
  );

/** The link is checked against the newest READY package, so without one it cannot be checked. */
export const noPackage = () =>
  new AppError(
    'polygon_no_package',
    409,
    'The Polygon problem has no READY package to check the link against: build a package on Polygon first',
  );

/** `code` is shown only to a user who may edit that QHHOJ problem. */
export const alreadyLinked = (polygonId: number, code: string | null) =>
  code === null
    ? new AppError(
        'polygon_already_linked',
        409,
        `Polygon problem ${polygonId} is already linked to a QHHOJ problem`,
      )
    : new AppError(
        'polygon_already_linked',
        409,
        `Polygon problem ${polygonId} is already linked to ${code}`,
        undefined,
        undefined,
        { linkedProblemCode: code },
      );
