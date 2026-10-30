import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { SendResult, UploadResult } from '../hooks/useConversation';
import { colors } from '../constants/colors';
import { ATTACHMENT_CONTENT_TYPES, PickedFile, isPreviewableImage } from '../types/messaging';

type Props = {
  onSend: (messageText: string, attachmentIds: string[]) => Promise<SendResult>;
  sending: boolean;
  onAttach: (file: PickedFile) => Promise<UploadResult>;
  uploading: boolean;
};

// A file that finished uploading and will go out with the next message.
// `uri` is the local copy, used for the thumbnail.
type Attached = { id: string; name: string; mimeType: string; uri: string };

// The text box, paperclip and send button. Keeps its own draft text and the file waiting to
// be sent, and shows send and upload errors (like the 3-second limit) underneath.
export function Composer({ onSend, sending, onAttach, uploading }: Props) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [attached, setAttached] = useState<Attached | null>(null);

  const canSend = (draft.trim().length > 0 || attached !== null) && !sending && !uploading;

  async function handleSend() {
    if (!canSend) return;
    const result = await onSend(draft, attached ? [attached.id] : []);
    if (result.ok) {
      setDraft('');
      setAttached(null);
      setError(null);
    } else {
      // Keep the draft so the user can just press send again.
      setError(result.error);
    }
  }

  async function handleAttach() {
    if (uploading) return;
    setError(null);

    const picked = await DocumentPicker.getDocumentAsync({
      type: ATTACHMENT_CONTENT_TYPES,
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (picked.canceled || picked.assets.length === 0) return;

    const asset = picked.assets[0];
    // Some pickers don't report a size; read it from the file so the limit check is accurate.
    const sizeBytes = asset.size ?? (await (await fetch(asset.uri)).blob()).size;
    const mimeType = asset.mimeType ?? 'application/octet-stream';
    const result = await onAttach({ uri: asset.uri, name: asset.name, mimeType, sizeBytes });
    if (result.ok) {
      // Wait for the send button: the file goes out with the next message.
      setAttached({ id: result.attachment.id, name: asset.name, mimeType, uri: asset.uri });
    } else {
      setError(result.error);
    }
  }

  return (
    <View>
      {attached && (
        <View style={styles.attachedRow}>
          {isPreviewableImage(attached.mimeType) ? (
            <Image accessibilityLabel={attached.name} source={{ uri: attached.uri }} style={styles.thumbnail} />
          ) : (
            <View style={[styles.thumbnail, styles.fileThumbnail]}>
              <Text style={styles.fileThumbnailText}>📄</Text>
            </View>
          )}
          <Text numberOfLines={1} style={styles.attachedName}>
            {attached.name}
          </Text>
          <Pressable
            accessibilityLabel="Remove attachment"
            accessibilityRole="button"
            onPress={() => setAttached(null)}
            style={styles.removeButton}
          >
            <Text style={styles.removeButtonText}>✕</Text>
          </Pressable>
        </View>
      )}
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
          accessibilityLabel="Attach file"
          accessibilityRole="button"
          disabled={uploading}
          onPress={handleAttach}
          style={styles.attachButton}
        >
          {uploading ? (
            <ActivityIndicator color={colors.textMuted} size="small" />
          ) : (
            <Text style={styles.attachButtonText}>📎</Text>
          )}
        </Pressable>
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
      {uploading && <Text style={styles.notice}>Uploading…</Text>}
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
  attachButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachButtonText: {
    fontSize: 20,
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
  attachedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    padding: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
  },
  thumbnail: {
    width: 44,
    height: 44,
    borderRadius: 8,
  },
  fileThumbnail: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  fileThumbnailText: {
    fontSize: 22,
  },
  attachedName: {
    flex: 1,
    marginHorizontal: 10,
    color: colors.text,
    fontSize: 13,
  },
  removeButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeButtonText: {
    color: colors.textMuted,
    fontSize: 15,
  },
  notice: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
  error: {
    color: colors.error,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
});
