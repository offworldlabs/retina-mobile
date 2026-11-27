import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { resendClaim, type MyClaim } from '@/api';
import { Button, ThemedText } from '@/components';
import { useNow } from './clock';
import { claimRow, isNotFound, resendOutcome } from './model';
import { useTheme } from '@/theme';

type Note = { text: string; failed: boolean; gone: boolean };

/** How often a row reads again whether its link still works. */
const CLOCK_MS = 15_000;

/** One claim, with what its last resend did and the button to send its link again. */
function ClaimItem({
  claim,
  note,
  busy,
  onResend,
}: {
  claim: MyClaim;
  note: Note | undefined;
  busy: boolean;
  onResend: () => void;
}) {
  const { spacing } = useTheme();
  const now = useNow(CLOCK_MS);
  const row = claimRow(claim, now);
  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ gap: spacing.xs }}>
        <ThemedText variant="mono" selectable>
          {row.nodeRef}
        </ThemedText>
        <ThemedText variant="caption" color="secondary">
          {row.givenTo}
        </ThemedText>
        <ThemedText variant="caption" color={row.live ? 'secondary' : 'warning'}>
          {row.linkText}
        </ThemedText>
        {note && !note.gone && (
          <ThemedText
            variant="caption"
            color={note.failed ? 'error' : 'secondary'}
            accessibilityRole={note.failed ? 'alert' : undefined}
          >
            {note.text}
          </ThemedText>
        )}
      </View>
      <Button
        variant="secondary"
        label={busy ? 'Sending…' : 'Send the link again'}
        disabled={busy}
        onPress={onResend}
      />
    </View>
  );
}

/**
 * Nodes that were given the owner's address and are not on the account yet, each with a way to have
 * the link mailed again. Nothing when there are none. `onSent` asks for the list to be read anew:
 * after a mail is queued, and when the server says the claim is gone.
 */
export function OpenClaims({ claims, onSent }: { claims: readonly MyClaim[]; onSent: () => void }) {
  const { colors, spacing, radius } = useTheme();
  const [sending, setSending] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState<Record<string, Note>>({});
  const inFlight = useRef(new Set<string>());
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function resend(nodeRef: string) {
    if (inFlight.current.has(nodeRef)) return;
    inFlight.current.add(nodeRef);
    setSending((all) => ({ ...all, [nodeRef]: true }));
    setNotes(({ [nodeRef]: _dropped, ...rest }) => rest);
    let error: unknown = null;
    try {
      await resendClaim(nodeRef);
    } catch (e) {
      error = e;
    }
    inFlight.current.delete(nodeRef);
    if (!mounted.current) return;
    const outcome = resendOutcome(nodeRef, error);
    setSending((all) => ({ ...all, [nodeRef]: false }));
    // A send is said in its own row, as the web says it; only a 404 goes under the list, which
    // the refresh is about to take the row out of.
    setNotes((all) => ({
      ...all,
      [nodeRef]: { text: outcome.text, failed: error !== null, gone: isNotFound(error) },
    }));
    if (error === null || outcome.refresh) onSent();
  }

  const gone = Object.entries(notes).filter(([, note]) => note.gone);
  if (claims.length === 0 && gone.length === 0) return null;

  return (
    <View
      style={{
        padding: spacing.xl,
        gap: spacing.lg,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.bgCard,
      }}
    >
      <View style={{ gap: spacing.xs }}>
        <ThemedText variant="heading" accessibilityRole="header">
          Waiting for you
        </ThemedText>
        <ThemedText variant="caption" color="secondary">
          Nodes that were given your address and are not on your account yet.
        </ThemedText>
      </View>
      {claims.map((claim) => (
        <ClaimItem
          key={claim.node_ref}
          claim={claim}
          note={notes[claim.node_ref]}
          busy={sending[claim.node_ref] === true}
          onResend={() => resend(claim.node_ref)}
        />
      ))}
      {gone.map(([nodeRef, note]) => (
        <ThemedText key={nodeRef} variant="caption" color="secondary">
          {note.text}
        </ThemedText>
      ))}
    </View>
  );
}
