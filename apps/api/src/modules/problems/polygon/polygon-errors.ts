import { AppError } from '@libs/common';
import {
  newestPackageOf,
  packageNotReadyReason,
  PolygonApiError,
} from '@libs/problems';
import type { PolygonErrorCode, PolygonPackageInfo } from '@libs/problems';

/** Polygon is the upstream: its refusals are gateway errors, not the caller's. */
const STATUS: Record<PolygonErrorCode, number> = {
  polygon_not_connected: 409,
  polygon_unauthorized: 502,
  polygon_clock_skew: 502,
  polygon_failed: 502,
  polygon_unavailable: 503,
  polygon_package_unavailable: 502,
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

/** Names Polygon's newest package, also as `newestPackage` (id, revision, state RUNNING or FAILED, and Polygon's comment on it), so the setter sees why a build failed. */
export const packageNotReady = (
  polygonId: number,
  packages: PolygonPackageInfo[],
) =>
  new AppError(
    'polygon_package_not_ready',
    409,
    `Polygon problem ${polygonId} has no READY package: ${packageNotReadyReason(packages)}. Build a package on Polygon first`,
    undefined,
    undefined,
    { newestPackage: newestPackageOf(packages) },
  );

/** Another request is reading this problem's package for its first link check; the first check of a large package can take minutes. */
export const linkBeingChecked = () =>
  new AppError(
    'polygon_link_checking',
    409,
    'This Polygon problem is being checked for the first time, which can take a few minutes for a large package: check again in a minute',
    undefined,
    { 'Retry-After': '60' },
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

/** The holder is in its deletion grace period: only a restore (then an unlink) frees the Polygon problem before the purge does. `code` is shown only to a user who may edit that QHHOJ problem. */
export const linkedToDeleted = (polygonId: number, code: string | null) =>
  code === null
    ? new AppError(
        'polygon_linked_deleted',
        409,
        `Polygon problem ${polygonId} is linked to a deleted QHHOJ problem; its owner can restore it and unlink it, or it is freed when the problem is purged`,
      )
    : new AppError(
        'polygon_linked_deleted',
        409,
        `Polygon problem ${polygonId} is linked to the deleted problem ${code}: restore ${code} and unlink it from Polygon, or wait for its purge`,
        undefined,
        undefined,
        { linkedProblemCode: code },
      );
