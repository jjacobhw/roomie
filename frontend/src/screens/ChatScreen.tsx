import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Composer } from '../components/Composer';
import { MessageBubble } from '../components/MessageBubble';
import { useConversation } from '../hooks/useConversation';
import { USERS, Username } from '../types/messaging';
import { colors } from '../constants/colors';

type Props = {
  inviteCode: string;
};

export function ChatScreen({ inviteCode }: Props) {
  // Sprint 1: usernames are hardcoded, so the picker lets one phone act as either user.
  const [activeUser, setActiveUser] = useState<Username>(USERS[0]);
  const { messages, loading, loadError, sending, send } = useConversation(
    activeUser,
    inviteCode,
  );
  const scrollRef = useRef<ScrollView>(null);

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
          <Text style={styles.conversationTitle}>House chat</Text>
          <View style={styles.inviteCode}>
            <Text style={styles.inviteLabel}>INVITE CODE</Text>
            <Text style={styles.inviteValue}>{inviteCode}</Text>
          </View>
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
                isMine={message.username === activeUser}
              />
            ))}
          </ScrollView>
        )}

        <View style={styles.composerArea}>
          <Text style={styles.sendingAsLabel}>SENDING AS</Text>
          <View style={styles.userPicker}>
            {USERS.map((username) => {
              const selected = username === activeUser;
              return (
                <Pressable
                  key={username}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setActiveUser(username)}
                  style={[styles.userOption, selected && styles.selectedUserOption]}
                >
                  <Text
                    style={[styles.userOptionText, selected && styles.selectedUserOptionText]}
                  >
                    {username}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Composer onSend={send} sending={sending} />
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
    backgroundColor: colors.surface,
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
    fontSize: 17,
    fontWeight: '700',
  },
  headerSubtitle: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  onlineDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.online,
  },
  conversationHeader: {
    paddingHorizontal: 22,
    paddingVertical: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  conversationTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '700',
  },
  inviteCode: {
    alignItems: 'flex-end',
  },
  inviteLabel: {
    color: colors.textFaint,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
  },
  inviteValue: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginTop: 4,
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
  userPicker: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  userOption: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
    marginRight: 7,
  },
  selectedUserOption: {
    backgroundColor: colors.primarySoft,
  },
  userOptionText: {
    color: colors.textMuted,
    fontSize: 11,
  },
  selectedUserOptionText: {
    color: colors.primary,
    fontWeight: '700',
  },
  demoFootnote: {
    color: colors.textFaint,
    fontSize: 10,
    textAlign: 'center',
    paddingTop: 8,
    paddingBottom: 3,
  },
});
