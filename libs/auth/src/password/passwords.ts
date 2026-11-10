import { Inject, Injectable } from '@nestjs/common';
import { TUNING } from '@libs/common';
import {
  hashPassword,
  needsRehash,
  PASSWORD_ITERATIONS,
  verifyPassword,
} from './password-hasher';

export interface PasswordTuning {
  /** The cost of a new hash and the floor below which a login rehashes; specs lower it so logins skip the 870k rounds. */
  passwordIterations: number;
}
export const PASSWORD_TUNING: PasswordTuning = {
  passwordIterations: PASSWORD_ITERATIONS,
};

/** The password hasher at the process's cost. */
@Injectable()
export class Passwords {
  constructor(@Inject(TUNING) private readonly tuning: PasswordTuning) {}

  hash(password: string, requester?: string): Promise<string> {
    return hashPassword(password, {
      requester,
      iterations: this.tuning.passwordIterations,
    });
  }

  verify(password: string, encoded: string, requester?: string) {
    return verifyPassword(
      password,
      encoded,
      requester,
      this.tuning.passwordIterations,
    );
  }

  needsRehash(encoded: string): boolean {
    return needsRehash(encoded, this.tuning.passwordIterations);
  }
}
