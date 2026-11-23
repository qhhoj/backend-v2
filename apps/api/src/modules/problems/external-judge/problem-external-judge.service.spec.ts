import type { ExternalJudgeClient } from '@libs/judging';
import { ProblemExternalJudgeService } from './problem-external-judge.service';

const PROBLEM = {
  _id: 'p1',
  allowedLanguages: [],
  externalJudge: null,
  isManuallyManaged: false,
  mirrorOf: null,
};

function setup(configured: boolean) {
  const update = jest.fn().mockResolvedValue(undefined);
  const service = new ProblemExternalJudgeService(
    { editableProblem: jest.fn().mockResolvedValue(PROBLEM) } as never,
    { update, findById: jest.fn().mockResolvedValue(PROBLEM) } as never,
    { append: jest.fn() } as never,
    { byId: jest.fn() } as never,
    { isConfigured: () => configured } as unknown as ExternalJudgeClient,
  );
  return { service, update };
}

function link(isActive: boolean) {
  return { isActive, oj: 'QOJ', problemId: '1', languages: [] };
}

const auth = { principal: { userId: 'u1' } } as never;

describe('ProblemExternalJudgeService.put while the site has no external judge', () => {
  it('refuses an active link with 409 external_judge_not_configured and stores nothing', async () => {
    const { service, update } = setup(false);
    await expect(service.put(auth, 'A', link(true))).rejects.toMatchObject({
      code: 'external_judge_not_configured',
      status: 409,
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('still stores an inactive link, which sends no submission', async () => {
    const { service, update } = setup(false);
    await service.put(auth, 'A', link(false));
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('stores an active link when an external judge is configured', async () => {
    const { service, update } = setup(true);
    await service.put(auth, 'A', link(true));
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe('ProblemExternalJudgeService.remove while the site has no external judge', () => {
  it('still removes the link', async () => {
    const { service, update } = setup(false);
    await service.remove(auth, 'A');
    expect(update).toHaveBeenCalledTimes(1);
  });
});
