import { useState } from 'react';
import { Image, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Message, MessageAttachment, isPreviewableImage } from '../types/messaging';
import { colors } from '../constants/colors';

type Props = {
  message: Message;
  isMine: boolean;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// One message in the list: the sender's messages on the right, everyone else's on the left.
// Pictures show inline (tap for full size); other files are a tappable chip that opens the file.
export function MessageBubble({ message, isMine }: Props) {
  const [viewing, setViewing] = useState<MessageAttachment | null>(null);

  return (
    <View style={[styles.row, isMine ? styles.myRow : styles.theirRow]}>
      {!isMine && (
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{message.username[0].toUpperCase()}</Text>
        </View>
      )}
      <View style={[styles.content, isMine ? styles.myContent : styles.theirContent]}>
        {!isMine && <Text style={styles.senderName}>{message.username}</Text>}
        {message.attachments.map((attachment) =>
          isPreviewableImage(attachment.contentType) ? (
            <Pressable
              accessibilityLabel={`Open image ${attachment.fileName}`}
              accessibilityRole="imagebutton"
              key={attachment.id}
              onPress={() => setViewing(attachment)}
              style={styles.attachment}
            >
              <Image
                accessibilityLabel={attachment.fileName}
                resizeMode="cover"
                source={{ uri: attachment.url }}
                style={styles.image}
              />
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="link"
              key={attachment.id}
              onPress={() => Linking.openURL(attachment.url)}
              style={[styles.attachment, styles.fileChip]}
            >
              <Text style={styles.fileChipIcon}>📄</Text>
              <View style={styles.fileChipText}>
                <Text numberOfLines={1} style={styles.fileName}>
                  {attachment.fileName}
                </Text>
                <Text style={styles.fileSize}>{formatSize(attachment.sizeBytes)}</Text>
              </View>
            </Pressable>
          ),
        )}
        {message.messageText.length > 0 && (
          <View style={[styles.bubble, isMine ? styles.myBubble : styles.theirBubble]}>
            <Text style={[styles.text, isMine && styles.myText]}>{message.messageText}</Text>
          </View>
        )}
        <Text style={[styles.timestamp, isMine && styles.myTimestamp]}>
          {new Date(message.timestamp).toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
          })}
        </Text>
      </View>

      <Modal animationType="fade" onRequestClose={() => setViewing(null)} transparent visible={viewing !== null}>
        <Pressable accessibilityLabel="Close image" onPress={() => setViewing(null)} style={styles.viewer}>
          {viewing && (
            <Image
              accessibilityLabel={viewing.fileName}
              resizeMode="contain"
              source={{ uri: viewing.url }}
              style={styles.viewerImage}
            />
          )}
          <Text style={styles.viewerClose}>✕</Text>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 17,
  },
  myRow: {
    justifyContent: 'flex-end',
  },
  theirRow: {
    justifyContent: 'flex-start',
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    marginBottom: 17,
    backgroundColor: colors.avatarBackground,
  },
  avatarText: {
    color: colors.avatarText,
    fontSize: 12,
    fontWeight: '700',
  },
  content: {
    maxWidth: '78%',
  },
  myContent: {
    alignItems: 'flex-end',
  },
  theirContent: {
    alignItems: 'flex-start',
  },
  senderName: {
    color: colors.textMuted,
    fontSize: 11,
    marginBottom: 5,
    marginLeft: 3,
  },
  bubble: {
    borderRadius: 17,
    paddingHorizontal: 15,
    paddingVertical: 11,
  },
  myBubble: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: 5,
  },
  theirBubble: {
    backgroundColor: colors.surface,
    borderBottomLeftRadius: 5,
    borderWidth: 1,
    borderColor: colors.border,
  },
  text: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 21,
  },
  myText: {
    color: colors.onPrimary,
  },
  attachment: {
    marginBottom: 6,
  },
  image: {
    width: 220,
    height: 180,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
  },
  fileChip: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 220,
    padding: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  fileChipIcon: {
    fontSize: 22,
    marginRight: 10,
  },
  fileChipText: {
    flex: 1,
  },
  fileName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  fileSize: {
    color: colors.textFaint,
    fontSize: 11,
    marginTop: 2,
  },
  viewer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.88)',
  },
  viewerImage: {
    width: '94%',
    height: '86%',
  },
  viewerClose: {
    position: 'absolute',
    top: 48,
    right: 22,
    color: '#FFFFFF',
    fontSize: 24,
  },
  timestamp: {
    color: colors.textFaint,
    fontSize: 10,
    marginTop: 5,
    marginHorizontal: 3,
  },
  myTimestamp: {
    textAlign: 'right',
  },
});
