import { StyleSheet, Text, View } from 'react-native';
import { Message } from '../types/messaging';
import { colors } from '../constants/colors';

type Props = {
  message: Message;
  isMine: boolean;
};

// One message in the list: the sender's messages on the right, everyone else's on the left.
export function MessageBubble({ message, isMine }: Props) {
  return (
    <View style={[styles.row, isMine ? styles.myRow : styles.theirRow]}>
      {!isMine && (
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{message.username[0].toUpperCase()}</Text>
        </View>
      )}
      <View style={[styles.content, isMine ? styles.myContent : styles.theirContent]}>
        {!isMine && <Text style={styles.senderName}>{message.username}</Text>}
        <View style={[styles.bubble, isMine ? styles.myBubble : styles.theirBubble]}>
          <Text style={[styles.text, isMine && styles.myText]}>{message.messageText}</Text>
        </View>
        <Text style={[styles.timestamp, isMine && styles.myTimestamp]}>
          {new Date(message.timestamp).toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
          })}
        </Text>
      </View>
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
