import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { ORGANIZATION_REQUEST_STATES } from '@libs/database';
import { loadDocument, operationOf, parameterOf } from './document';
import { inlineEnumSites, looseSites } from './schema-scans';

const PAGED = [
  '/api/internal/organizations',
  '/api/internal/organizations/{slug}/members',
  '/api/internal/users',
  '/api/internal/contributors',
  '/api/internal/users/{username}/pp-breakdown',
  '/api/internal/admin/users',
];
const PAGE_ONLY = [
  '/api/internal/organizations/{slug}/requests',
  '/api/internal/admin/organization-requests',
];
/** The routes and schemas this lane owns. `PostPageQueryDto` (org posts, user blog) belongs to the blog lane. */
const OWN_ROUTE =
  /\/api\/internal\/(auth|users|contributors|organizations|profile|admin\/users|admin\/organization-requests)\b/;
/** Schema sites are labelled `schema <Name>...` (loose) or are JSON pointers `/components/schemas/<Name>/...` (enums). */
const OWN_SCHEMA =
  /(^schema |\/components\/schemas\/)(ActivityQueryDto|ActivityResponse|AppearanceDto|AppearanceResponse|BanDto|ChangePasswordDto|CodeDto|ContributorListQueryDto|CreateOrganizationDto|CreateOrganizationRequestDto|CurrentPasswordDto|DecideOrganizationRequestDto|KickDto|LeaderboardEntryResponse|LoginDto|MemberListQueryDto|MemberResponse|OrganizationDetailResponse|OrganizationListItemResponse|OrganizationListQueryDto|OrganizationRequestListQueryDto|OrganizationRequestParamsDto|OrganizationRequestResponse|OrganizationSlugParamDto|OrganizationSummaryResponse|OrganizationViewerResponse|PasswordResetConfirmDto|PasswordResetRequestDto|PpBreakdownQueryDto|PpEntryResponse|PpSubmissionResponse|ProfileOrganizationResponse|ProfileResponse|RankQueryDto|RankResponse|RatingHistoryEntryResponse|RatingSummaryResponse|RegenerateTokenResponse|RegisterDto|ResendActivationDto|ScratchCodesRemainingResponse|ScratchCodesResponse|SessionResponse|SocialCompleteDto|SocialProvidersResponse|SolvedGroupResponse|SolvedProblemResponse|SolvedResponse|StaffUserResponse|TokenDto|TotpEnrollmentResponse|TwoFactorPendingResponse|UpdateOrganizationDto|UpdateProfileDto|UserAdminQueryDto|UserCommentsQueryDto|UserDataStatusResponse|UserListQueryDto|UserPageResponse|UserPageStaffResponse|UserResponse|UsernameAvailableDto|UsernameAvailableResponse|WebauthnCredentialResponse|WebauthnLoginDto|WebauthnRegisterDto)\b/;
const OWN_SITE = new RegExp(`${OWN_ROUTE.source}|${OWN_SCHEMA.source}`);
const BLOG_SITE = /\/(blog|posts)\b/;
/** Route labels start with the method; a schema label never does. */
const ROUTE_LABEL = /^(GET|POST|PUT|PATCH|DELETE) /;

describe('auth, user and organization schemas', () => {
  let document: OpenAPIObject;
  beforeAll(async () => {
    document = await loadDocument();
  });
  const schema = (name: string) => {
    const found = document.components?.schemas?.[name];
    if (!found) throw new Error(`The document has no schema ${name}`);
    return found as SchemaObject;
  };

  it('has no untyped parameter or bare object on these routes', () => {
    const owned = looseSites(document).filter(
      (site) =>
        OWN_SITE.test(site) &&
        !(ROUTE_LABEL.test(site) && BLOG_SITE.test(site)),
    );
    expect(owned).toEqual([]);
  });

  it('types the paging of every list as optional numbers', () => {
    for (const route of [...PAGED, ...PAGE_ONLY])
      expect(
        parameterOf(document, { route, method: 'get' }, 'page'),
      ).toMatchObject({
        required: false,
        schema: { type: 'number' },
      });
    for (const route of PAGED)
      expect(
        parameterOf(document, { route, method: 'get' }, 'pageSize'),
      ).toMatchObject({
        required: false,
        schema: { type: 'number' },
      });
  });

  it('shares one OrganizationRequestState enum', () => {
    expect(schema('OrganizationRequestState').enum).toHaveLength(
      ORGANIZATION_REQUEST_STATES.length,
    );
    expect(
      inlineEnumSites(document, ORGANIZATION_REQUEST_STATES).filter((site) =>
        OWN_SITE.test(site),
      ),
    ).toEqual([]);
  });

  it('documents the WebAuthn options as free-form objects, the login one nullable', () => {
    const dataOf = (route: string) =>
      (
        operationOf(document, route, 'post').responses['201'] as unknown as {
          content: {
            'application/json': {
              schema: { properties: { data: SchemaObject } };
            };
          };
        }
      ).content['application/json'].schema.properties.data;
    expect(
      dataOf('/api/internal/auth/2fa/webauthn/register/options'),
    ).toMatchObject({
      type: 'object',
      additionalProperties: true,
    });
    expect(
      dataOf('/api/internal/auth/2fa/webauthn/login/options'),
    ).toMatchObject({
      type: 'object',
      additionalProperties: true,
      nullable: true,
    });
  });

  it('documents the profile data download as a zip file', () => {
    expect(
      operationOf(document, '/api/internal/profile/data/download', 'get')
        .responses['200'],
    ).toMatchObject({
      content: {
        'application/zip': { schema: { type: 'string', format: 'binary' } },
      },
    });
  });
});
