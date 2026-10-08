import type { Principal } from '@libs/auth';
import type { UsersRepository } from '@libs/auth';
import { ContestEditFieldsService } from './contest-edit-fields.service';
import type { ProblemsRepository } from '../../problems/core/problems.repository';
import type { UpdateContestDto } from './dto/contest-edit.dto';

describe('ContestEditFieldsService.toFields', () => {
  const service = new ContestEditFieldsService(
    {} as ProblemsRepository,
    {} as UsersRepository,
  );
  const principal = {} as Principal;

  it('refuses null on a field that cannot be cleared before reading anything else', async () => {
    await expect(
      service.toFields(
        principal,
        { name: null } as unknown as UpdateContestDto,
        null,
      ),
    ).rejects.toMatchObject({ message: 'name cannot be null.' });
  });
});
