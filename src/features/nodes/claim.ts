import { sameEmail } from '@/features/auth';

/**
 * Where a confirmed claim left the node, as seen from the app: 'yours' when the account the
 * link was mailed to is the one signed in here, 'elsewhere' when it is another account or
 * nobody is signed in. The app's session is the same either way; only 'yours' shows the node.
 */
export function claimOutcome(
  signedInEmail: string | null,
  answerEmail: string,
): 'yours' | 'elsewhere' {
  return signedInEmail !== null && sameEmail(signedInEmail, answerEmail) ? 'yours' : 'elsewhere';
}
