import type { User } from '../../shared';
import { assertNotDeleted } from './auth';
import { AppError } from './errors';
import type { TransactionRepository } from './repository';

/** The identity lookup may precede the transaction, but state/role are always read inside it. */
export async function transactionUser(
  transaction: TransactionRepository,
  id: string,
  openid: string,
): Promise<User> {
  const user = await transaction.findUser(id);
  if (!user || user.openid !== openid) throw new AppError('UNAUTHORIZED');
  assertNotDeleted(user);
  if (user.status !== 'active') throw new AppError('USER_DISABLED');
  return user;
}
