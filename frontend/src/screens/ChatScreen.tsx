import { useRef } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Composer } from '../components/Composer';
import { MessageBubble } from '../components/MessageBubble';
import { useConversation } from '../hooks/useConversation';
import { colors } from '../constants/colors';
import { USING_MOCK } from '../config';

type Props = {
  username: string;
  token: string;
  inviteCode: string;
  // Sign out and go back to the sign-in screen.
  onLogout: () => void;
  // The server says the session is no longer valid.
  onSessionExpired: () => void;
};

export function ChatScreen({ username, token, inviteCode, onLogout, onSessionExpired }: Props) {
  const { messages, loading, loadError, sending, send } = useConversation(
    token,
    inviteCode,
    onSessionExpired,
  );
  const scrollRef = useRef<ScrollViewInstance>(null);

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
            {/* Temporary name until households can be named. */}
            <Text style={styles.headerTitle}>House chat</Text>
            {/* selectable: press and hold to copy the code and send it to a roommate. */}
            <Text selectable style={styles.headerCode}>
              Invite code: <Text style={styles.headerCodeValue}>{inviteCode}</Text>
            </Text>
          </View>
          <Pressable accessibilityRole="button" onPress={onLogout} style={styles.logoutButton}>
            <Text style={styles.logoutButtonText}>Log out</Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.messages}
            keyboardShouldPersistTaps="handled"
            // Jump to the newest message whenever the list grows.
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          >
            {loadError && <Text style={styles.loadError}>{loadError}</Text>}
            {!loadError && messages.length === 0 && (
              <Text style={styles.empty}>No messages yet. Say hi!</Text>
            )}
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                isMine={message.username === username}
              />
            ))}
          </ScrollView>
        )}

        <View style={styles.composerArea}>
          <Text style={styles.sendingAsLabel}>SENDING AS {username.toUpperCase()}</Text>
          <Composer onSend={send} sending={sending} />
          {USING_MOCK && (
            <Text style={styles.demoFootnote}>
              Local preview only — this screen does not connect to the database yet.
            </Text>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
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
    borderBottomColor: colors.border,
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  headerIconText: {
    color: colors.onPrimary,
    fontSize: 20,
    fontWeight: '800',
  },
  headerTitleGroup: {
    flex: 1,
    marginLeft: 12,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '700',
  },
  headerCode: {
    color: colors.textFaint,
    fontSize: 12,
    marginTop: 2,
  },
  headerCodeValue: {
    color: colors.primary,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  logoutButton: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: colors.primarySoft,
  },
  logoutButtonText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messages: {
    flexGrow: 1,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 24,
  },
  loadError: {
    color: colors.error,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 12,
  },
  empty: {
    color: colors.textFaint,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 24,
  },
  composerArea: {
    paddingHorizontal: 18,
    paddingTop: 13,
    paddingBottom: 10,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  sendingAsLabel: {
    color: colors.textFaint,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 7,
  },
  demoFootnote: {
    color: colors.textFaint,
    fontSize: 10,
    textAlign: 'center',
    paddingTop: 8,
    paddingBottom: 3,
  },
});
