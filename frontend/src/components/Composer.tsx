import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SendResult } from '../hooks/useConversation';
import { colors } from '../constants/colors';

type Props = {
  onSend: (messageText: string) => Promise<SendResult>;
  sending: boolean;
};

// The text box and send button. Keeps its own draft text and shows send errors
// (like the 3-second limit) underneath.
export function Composer({ onSend, sending }: Props) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const canSend = draft.trim().length > 0 && !sending;

  async function handleSend() {
    if (!canSend) return;
    const result = await onSend(draft);
    if (result.ok) {
      setDraft('');
      setError(null);
    } else {
      // Keep the draft so the user can just press send again.
      setError(result.error);
    }
  }

  return (
    <View>
      <View style={styles.composer}>
        <TextInput
          accessibilityLabel="Message"
          onChangeText={(text) => {
            setDraft(text);
            setError(null);
          }}
          onSubmitEditing={handleSend}
          placeholder="Write a message..."
          placeholderTextColor={colors.textFaint}
          returnKeyType="send"
          style={styles.input}
          value={draft}
        />
        <Pressable
          accessibilityLabel="Send message"
          accessibilityRole="button"
          disabled={!canSend}
          onPress={handleSend}
          style={[styles.sendButton, !canSend && styles.disabledSendButton]}
        >
          <Text style={styles.sendButtonText}>↑</Text>
        </Pressable>
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  composer: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 15,
    paddingRight: 5,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 25,
    backgroundColor: colors.surfaceMuted,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    paddingVertical: 10,
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  disabledSendButton: {
    backgroundColor: colors.primaryDisabled,
  },
  sendButtonText: {
    color: colors.onPrimary,
    fontSize: 23,
    fontWeight: '600',
    lineHeight: 27,
  },
  error: {
    color: colors.error,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
});
