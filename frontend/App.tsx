import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

type ChatMessage = {
  id: string;
  username: string;
  messageText: string;
  timestamp: Date;
};

const users = ['testuser', 'world'] as const;
type Username = (typeof users)[number];

function runTextingTestCase() {
  const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  const now = Date.now();

  return {
    inviteCode,
    messages: [
      {
        id: 'test-message-a',
        username: 'testuser',
        messageText: 'Hello, world!',
        timestamp: new Date(now - 60_000),
      },
      {
        id: 'test-message-b',
        username: 'world',
        messageText: 'Hi! 342621!?',
        timestamp: new Date(now),
      },
    ] satisfies ChatMessage[],
  };
}

export default function App() {
  const [demo, setDemo] = useState(runTextingTestCase);
  const [activeUser, setActiveUser] = useState<Username>('testuser');
  const [draft, setDraft] = useState('');

  function replayTestCase() {
    setDemo(runTextingTestCase());
    setActiveUser('testuser');
    setDraft('');
  }

  function sendMessage() {
    const messageText = draft.trim();
    if (!messageText) return;

    setDemo((current) => ({
      ...current,
      messages: [
        ...current.messages,
        {
          id: `${Date.now()}`,
          username: activeUser,
          messageText,
          timestamp: new Date(),
        },
      ],
    }));
    setDraft('');
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardView}
      >
        <View style={styles.header}>
          <View style={styles.headerIcon}>
            <Text style={styles.headerIconText}>R</Text>
          </View>
          <View style={styles.headerTitleGroup}>
            <Text style={styles.headerTitle}>Roomie</Text>
            <Text style={styles.headerSubtitle}>Your household, in sync</Text>
          </View>
          <View style={styles.onlineDot} />
        </View>

        <View style={styles.conversationHeader}>
          <View>
            <Text style={styles.conversationTitle}>House chat</Text>
            <Text style={styles.memberCount}>2 roommates</Text>
          </View>
          <View style={styles.inviteCode}>
            <Text style={styles.inviteLabel}>INVITE CODE</Text>
            <Text style={styles.inviteValue}>{demo.inviteCode}</Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.messages}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.testNotice}>
            <Text style={styles.testNoticeIcon}>✓</Text>
            <View style={styles.testNoticeCopy}>
              <Text style={styles.testNoticeTitle}>Texting example complete</Text>
              <Text style={styles.testNoticeText}>
                testuser created the chat, world joined, and both sent a message.
              </Text>
            </View>
          </View>

          <Text style={styles.dateDivider}>TODAY</Text>

          {demo.messages.map((message) => {
            const isMine = message.username === activeUser;
            return (
              <View
                key={message.id}
                style={[
                  styles.messageRow,
                  isMine ? styles.myMessageRow : styles.theirMessageRow,
                ]}
              >
                {!isMine && (
                  <View style={[styles.avatar, styles.otherAvatar]}>
                    <Text style={styles.otherAvatarText}>
                      {message.username[0].toUpperCase()}
                    </Text>
                  </View>
                )}
                <View
                  style={[
                    styles.messageContent,
                    isMine ? styles.myMessageContent : styles.theirMessageContent,
                  ]}
                >
                  {!isMine && (
                    <Text style={styles.senderName}>{message.username}</Text>
                  )}
                  <View
                    style={[
                      styles.bubble,
                      isMine ? styles.myBubble : styles.theirBubble,
                    ]}
                  >
                    <Text
                      style={[
                        styles.messageText,
                        isMine && styles.myMessageText,
                      ]}
                    >
                      {message.messageText}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.timestamp,
                      isMine && styles.myTimestamp,
                    ]}
                  >
                    {message.timestamp.toLocaleTimeString([], {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </Text>
                </View>
              </View>
            );
          })}
        </ScrollView>

        <View style={styles.composerArea}>
          <Text style={styles.sendingAsLabel}>SENDING AS</Text>
          <View style={styles.userPicker}>
            {users.map((username) => {
              const selected = username === activeUser;
              return (
                <Pressable
                  key={username}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setActiveUser(username)}
                  style={[
                    styles.userOption,
                    selected && styles.selectedUserOption,
                  ]}
                >
                  <Text
                    style={[
                      styles.userOptionText,
                      selected && styles.selectedUserOptionText,
                    ]}
                  >
                    {username}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.composer}>
            <TextInput
              accessibilityLabel="Message"
              onChangeText={setDraft}
              onSubmitEditing={sendMessage}
              placeholder="Write a message..."
              placeholderTextColor="#9A9BA3"
              returnKeyType="send"
              style={styles.input}
              value={draft}
            />
            <Pressable
              accessibilityLabel="Send message"
              accessibilityRole="button"
              disabled={!draft.trim()}
              onPress={sendMessage}
              style={[
                styles.sendButton,
                !draft.trim() && styles.disabledSendButton,
              ]}
            >
              <Text style={styles.sendButtonText}>↑</Text>
            </Pressable>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={replayTestCase}
            style={styles.replayButton}
          >
            <Text style={styles.replayButtonText}>Replay texting demo</Text>
          </Pressable>
          <Text style={styles.demoFootnote}>
            Local preview only — this screen does not connect to the database yet.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8F8F6',
  },
  keyboardView: {
    flex: 1,
  },
  header: {
    height: 72,
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#ECECE8',
    backgroundColor: '#FFFFFF',
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#286A54',
  },
  headerIconText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
  },
  headerTitleGroup: {
    flex: 1,
    marginLeft: 12,
  },
  headerTitle: {
    color: '#202521',
    fontSize: 17,
    fontWeight: '700',
  },
  headerSubtitle: {
    color: '#858982',
    fontSize: 12,
    marginTop: 2,
  },
  onlineDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#55A77B',
  },
  conversationHeader: {
    paddingHorizontal: 22,
    paddingVertical: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#ECECE8',
  },
  conversationTitle: {
    color: '#202521',
    fontSize: 19,
    fontWeight: '700',
  },
  memberCount: {
    color: '#858982',
    fontSize: 13,
    marginTop: 4,
  },
  inviteCode: {
    alignItems: 'flex-end',
  },
  inviteLabel: {
    color: '#92968F',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
  },
  inviteValue: {
    color: '#286A54',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginTop: 4,
  },
  messages: {
    flexGrow: 1,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 24,
  },
  testNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 13,
    borderRadius: 13,
    backgroundColor: '#EAF3EE',
    marginBottom: 24,
  },
  testNoticeIcon: {
    color: '#286A54',
    fontSize: 17,
    fontWeight: '800',
    marginRight: 10,
  },
  testNoticeCopy: {
    flex: 1,
  },
  testNoticeTitle: {
    color: '#285B46',
    fontSize: 13,
    fontWeight: '700',
  },
  testNoticeText: {
    color: '#527160',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  dateDivider: {
    color: '#A0A39D',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    textAlign: 'center',
    marginBottom: 18,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 17,
  },
  myMessageRow: {
    justifyContent: 'flex-end',
  },
  theirMessageRow: {
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
  },
  otherAvatar: {
    backgroundColor: '#DDE8E0',
  },
  otherAvatarText: {
    color: '#3E6B51',
    fontSize: 12,
    fontWeight: '700',
  },
  messageContent: {
    maxWidth: '78%',
  },
  myMessageContent: {
    alignItems: 'flex-end',
  },
  theirMessageContent: {
    alignItems: 'flex-start',
  },
  senderName: {
    color: '#777D75',
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
    backgroundColor: '#286A54',
    borderBottomRightRadius: 5,
  },
  theirBubble: {
    backgroundColor: '#FFFFFF',
    borderBottomLeftRadius: 5,
    borderWidth: 1,
    borderColor: '#ECECE8',
  },
  messageText: {
    color: '#252925',
    fontSize: 15,
    lineHeight: 21,
  },
  myMessageText: {
    color: '#FFFFFF',
  },
  timestamp: {
    color: '#969A93',
    fontSize: 10,
    marginTop: 5,
    marginHorizontal: 3,
  },
  myTimestamp: {
    textAlign: 'right',
  },
  composerArea: {
    paddingHorizontal: 18,
    paddingTop: 13,
    paddingBottom: 10,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#ECECE8',
  },
  sendingAsLabel: {
    color: '#90948D',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 7,
  },
  userPicker: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  userOption: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#F2F3F0',
    marginRight: 7,
  },
  selectedUserOption: {
    backgroundColor: '#E4F0E9',
  },
  userOptionText: {
    color: '#777D75',
    fontSize: 11,
  },
  selectedUserOptionText: {
    color: '#286A54',
    fontWeight: '700',
  },
  composer: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 15,
    paddingRight: 5,
    borderWidth: 1,
    borderColor: '#E8E9E5',
    borderRadius: 25,
    backgroundColor: '#FAFAF9',
  },
  input: {
    flex: 1,
    color: '#252925',
    fontSize: 14,
    paddingVertical: 10,
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#286A54',
  },
  disabledSendButton: {
    backgroundColor: '#A9BDB2',
  },
  sendButtonText: {
    color: '#FFFFFF',
    fontSize: 23,
    fontWeight: '600',
    lineHeight: 27,
  },
  replayButton: {
    alignSelf: 'center',
    paddingVertical: 9,
    paddingHorizontal: 12,
    marginTop: 6,
  },
  replayButtonText: {
    color: '#286A54',
    fontSize: 12,
    fontWeight: '700',
  },
  demoFootnote: {
    color: '#9A9D97',
    fontSize: 10,
    textAlign: 'center',
    paddingBottom: 3,
  },
});
