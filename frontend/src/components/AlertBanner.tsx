import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../constants/colors';
import { Message } from '../types/messaging';
import { canAcknowledge } from '../utils/messages';

type Props = {
  alert: Message;
  username: string;
  // Marks the alert as seen by the current user.
  onAcknowledge: (alertId: string) => Promise<{ ok: boolean }>;
};

// Pinned under the chat header so a new alert can't scroll out of sight.
// Shows who posted it and who has seen it, and lets you say you've seen it.
export function AlertBanner({ alert, username, onAcknowledge }: Props) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleAcknowledge() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const result = await onAcknowledge(alert.id);
    setBusy(false);
    if (!result.ok) setFailed(true);
  }

  return (
    <View accessibilityRole="alert" style={styles.banner}>
      <Text style={styles.icon}>🔔</Text>
      <View style={styles.body}>
        <Text style={styles.label}>ALERT · {alert.username}</Text>
        {alert.messageText.length > 0 && (
          <Text numberOfLines={3} style={styles.text}>
            {alert.messageText}
          </Text>
        )}
        <Text style={styles.seenBy}>
          {alert.seenBy.length > 0 ? `Seen by ${alert.seenBy.join(', ')}` : 'Not seen by anyone yet'}
        </Text>
        {failed && <Text style={styles.error}>Couldn’t mark as seen. Try again.</Text>}
      </View>
      {canAcknowledge(alert, username) && (
        <Pressable
          accessibilityLabel="Mark alert as seen"
          accessibilityRole="button"
          disabled={busy}
          onPress={handleAcknowledge}
          style={styles.button}
        >
          {busy ? <ActivityIndicator color={colors.onPrimary} size="small" /> : <Text style={styles.buttonText}>Got it</Text>}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: colors.alertBackground,
    borderBottomWidth: 1,
    borderBottomColor: colors.alertBorder,
  },
  icon: {
    fontSize: 20,
    marginRight: 10,
  },
  body: {
    flex: 1,
  },
  label: {
    color: colors.alertText,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  text: {
    color: colors.alertText,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 2,
  },
  seenBy: {
    color: colors.alertText,
    fontSize: 11,
    marginTop: 4,
    opacity: 0.8,
  },
  error: {
    color: colors.error,
    fontSize: 11,
    marginTop: 3,
  },
  button: {
    minWidth: 64,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: colors.primary,
  },
  buttonText: {
    color: colors.onPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
});
