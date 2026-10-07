import type { PostDetailResponse } from '../src/modules/blog/core/dto/post.response';
import type { VoteResponse } from '../src/modules/contributions/dto/vote.response';
import { createPost, postUrl, writer } from './community-fixtures';
import { clearRateLimits } from './contest-fixtures';
import { createOrganization } from './organization-fixtures';
import { authed, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('blog votes', () => {
  let api: ApiTest;
  let userCount = 0;
  const person = async (extra = {}) => {
    const user = await writer(api, `postvoter${(userCount += 1)}`, extra);
    return { user, session: await loginAs(api, user._id) };
  };
  const vote = (id: string, session: TestSession, score: number) =>
    authed(api.http().put(postUrl(id, '/vote')), session).send({ score });

  beforeAll(async () => {
    api = await setupApiTest();
  });
  beforeEach(() => clearRateLimits(api));
  afterAll(() => api.teardown());

  it('votes, changes and withdraws, and shows the viewer their vote', async () => {
    const { user: author } = await person();
    const { session } = await person();
    const post = await createPost(api, { authors: [author._id] });
    expect(
      dataOf<VoteResponse>(await vote(post._id, session, 1).expect(200)),
    ).toEqual({ score: 1, viewerVote: 1 });
    expect(
      dataOf<VoteResponse>(await vote(post._id, session, -1).expect(200)).score,
    ).toBe(-1);
    expect(
      dataOf<PostDetailResponse>(
        await authed(api.http().get(postUrl(post._id)), session).expect(200),
      ),
    ).toMatchObject({ score: -1, viewerVote: -1 });
    expect(
      dataOf<VoteResponse>(await vote(post._id, session, 0).expect(200)),
    ).toEqual({ score: 0, viewerVote: 0 });
    await vote(post._id, session, 2).expect(400);
  });

  it('refuses votes on posts the voter cannot see', async () => {
    const { user: author } = await person();
    const { session: outsider } = await person();
    const { user: member, session: memberSession } = await person();
    const organization = await createOrganization(api, {}, [member._id]);
    const organizationPost = await createPost(api, {
      authors: [author._id],
      organization: organization._id,
    });
    const draft = await createPost(api, {
      authors: [author._id],
      visible: false,
    });
    await vote(organizationPost._id, outsider, 1)
      .expect(404)
      .expect(errorCode('not_found'));
    await vote(draft._id, outsider, 1).expect(404);
    await vote('nope', outsider, 1).expect(404);
    await vote(organizationPost._id, memberSession, 1).expect(200);
    expect(
      await api.blogVotes.countDocuments({ blog: { $in: [draft._id] } }),
    ).toBe(0);
  });

  it('refuses own posts, new and muted voters', async () => {
    const { user: author, session: authorSession } = await person();
    const post = await createPost(api, { authors: [author._id] });
    await vote(post._id, authorSession, 1).expect(403);
    await vote(post._id, (await person({ problemCount: 4 })).session, 1).expect(
      403,
    );
    await vote(post._id, (await person({ mute: true })).session, 1).expect(403);
    await authed(api.http().put(postUrl(post._id, '/vote')), {
      cookie: '',
      csrf: '',
    })
      .send({ score: 1 })
      .expect(401);
  });
});
