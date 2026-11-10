import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import { colors } from '../constants/colors';
import {
  getMembers,
  getMyConversation,
  leaveConversation,
  renameConversation,
} from '../services/messagingApi';
import { HOUSEHOLD_NAME_MAX_LENGTH, HouseholdMember, MessagingError } from '../types/messaging';
import { initial } from '../utils/members';

type Props = {
  username: string;
  token: string;
  inviteCode: string;
  // The name App already knows, shown straight away while the screen loads.
  householdName: string | null;
  // Back to the board.
  onBack: () => void;
  // The owner renamed the house; App keeps the new name for the board header.
  onRenamed: (name: string) => void;
  // The user left; App goes back to create / join.
  onLeft: () => void;
  onLogout: () => void;
  onSessionExpired: () => void;
};

// Alert.alert does nothing on web, so the browser's own confirm box is used there.
function confirmLeave(): Promise<boolean> {
  const title = 'Leave household?';
  const body = 'You will stop seeing its messages. You can rejoin later with the invite code.';
  if (Platform.OS === 'web') {
    return Promise.resolve(typeof window !== 'undefined' && window.confirm(`${title}\n\n${body}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, body, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Leave', style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

export function HouseholdInfoScreen({
  username,
  token,
  inviteCode,
  householdName,
  onBack,
  onRenamed,
  onLeft,
  onLogout,
  onSessionExpired,
}: Props) {
  const [name, setName] = useState(householdName ?? '');
  const [members, setMembers] = useState<HouseholdMember[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const me = username.toLowerCase();
  const isOwner = members?.some((m) => m.role === 'owner' && m.username.toLowerCase() === me) ?? false;

  // Shared by every request: an expired session goes back to sign in, anything else is shown.
  const messageFor = useCallback(
    (e: unknown): string | null => {
      if (e instanceof MessagingError && e.code === 'UNAUTHENTICATED') {
        onSessionExpired();
        return null;
      }
      return e instanceof Error ? e.message : 'Something went wrong';
    },
    [onSessionExpired],
  );

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [list, summary] = await Promise.all([getMembers(token, inviteCode), getMyConversation(token)]);
      setMembers(list);
      if (summary?.inviteCode === inviteCode && summary.name) setName(summary.name);
    } catch (e) {
      setLoadError(messageFor(e));
    }
  }, [token, inviteCode, messageFor]);

  useEffect(() => {
    load();
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, [load]);

  async function handleCopy() {
    await Clipboard.setStringAsync(inviteCode);
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2000);
  }

  async function handleShare() {
    const message = `Join ${name || 'our household'} on Roomie with invite code ${inviteCode}`;
    try {
      await Share.share({ message });
    } catch {
      // Browsers without a share sheet: copying is the next best thing.
      await handleCopy();
    }
  }

  function startEditing() {
    setDraft(name);
    setRenameError(null);
    setEditing(true);
  }

  async function handleSave() {
    const trimmed = draft.trim();
    if (!trimmed) {
      setRenameError('Name can’t be empty');
      return;
    }
    if (trimmed === name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setRenameError(null);
    try {
      const saved = await renameConversation(token, inviteCode, trimmed);
      setName(saved);
      onRenamed(saved);
      setEditing(false);
    } catch (e) {
      setRenameError(messageFor(e));
    }
    setSaving(false);
  }

  async function handleLeave() {
    if (!(await confirmLeave())) return;
    setLeaving(true);
    setLeaveError(null);
    try {
      await leaveConversation(token, inviteCode);
      onLeft();
      return;
    } catch (e) {
      // Already gone (removed, or the house was deleted): same result as leaving.
      if (e instanceof MessagingError && (e.code === 'CONVERSATION_NOT_FOUND' || e.code === 'ALREADY_IN_CONVERSATION')) {
        onLeft();
        return;
      }
      setLeaveError(messageFor(e));
    }
    setLeaving(false);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to the board"
          onPress={onBack}
          hitSlop={8}
          style={styles.backButton}
        >
          <Text style={styles.backChevron}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Household</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          {editing ? (
            <View style={styles.renameBox}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                autoFocus
                maxLength={HOUSEHOLD_NAME_MAX_LENGTH}
                placeholder="Household name"
                placeholderTextColor={colors.textMuted}
                returnKeyType="done"
                onSubmitEditing={handleSave}
                editable={!saving}
                style={styles.renameInput}
                accessibilityLabel="Household name"
              />
              {renameError && <Text style={styles.inlineError}>{renameError}</Text>}
              <View style={styles.row}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setEditing(false)}
                  disabled={saving}
                  style={[styles.button, styles.outlineButton, styles.rowButton]}
                >
                  <Text style={styles.outlineButtonText}>Cancel</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={handleSave}
                  disabled={saving}
                  style={[styles.button, styles.filledButton, styles.rowButton]}
                >
                  {saving ? (
                    <ActivityIndicator color={colors.onPrimary} />
                  ) : (
                    <Text style={styles.filledButtonText}>Save</Text>
                  )}
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.nameRow}>
              <Text style={styles.houseName} numberOfLines={2}>
                {name || 'Your household'}
              </Text>
              {isOwner && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Rename household"
                  onPress={startEditing}
                  hitSlop={10}
                  style={styles.renameLink}
                >
                  <Text style={styles.renameLinkText}>Rename</Text>
                </Pressable>
              )}
            </View>
          )}

          <Text style={styles.codeLabel}>Invite code</Text>
          <Text selectable style={styles.code}>
            {inviteCode}
          </Text>
          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              onPress={handleCopy}
              style={[styles.button, styles.outlineButton, styles.rowButton]}
            >
              <Text style={styles.outlineButtonText}>{copied ? 'Copied!' : 'Copy code'}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={handleShare}
              style={[styles.button, styles.filledButton, styles.rowButton]}
            >
              <Text style={styles.filledButtonText}>Share</Text>
            </Pressable>
          </View>
        </View>

        <Text style={styles.sectionLabel}>Members{members ? ` (${members.length})` : ''}</Text>
        {loadError ? (
          <View style={styles.card}>
            <Text style={styles.inlineError}>{loadError}</Text>
            <Pressable accessibilityRole="button" onPress={load} style={styles.retry}>
              <Text style={styles.renameLinkText}>Try again</Text>
            </Pressable>
          </View>
        ) : !members ? (
          <ActivityIndicator color={colors.primary} style={styles.spinner} />
        ) : (
          <View style={styles.list}>
            {members.map((member, index) => {
              const isMe = member.username.toLowerCase() === me;
              return (
                <View key={member.username} style={[styles.memberRow, index > 0 && styles.memberDivider]}>
                  <View style={[styles.avatar, isMe && styles.avatarMe]}>
                    <Text style={[styles.avatarText, isMe && styles.avatarTextMe]}>{initial(member.username)}</Text>
                  </View>
                  <Text style={styles.memberName} numberOfLines={1}>
                    {member.username}
                    {isMe ? ' (you)' : ''}
                  </Text>
                  {member.role === 'owner' && <Text style={styles.ownerTag}>Owner</Text>}
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.spacer} />

        {leaveError && <Text style={[styles.inlineError, styles.centerText]}>{leaveError}</Text>}
        <Pressable
          accessibilityRole="button"
          onPress={handleLeave}
          disabled={leaving}
          style={[styles.button, styles.leaveButton]}
        >
          {leaving ? (
            <ActivityIndicator color={colors.error} />
          ) : (
            <Text style={styles.leaveButtonText}>Leave household</Text>
          )}
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onLogout} style={styles.logoutButton}>
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    height: 64,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backChevron: {
    color: colors.primary,
    fontSize: 34,
    lineHeight: 38,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '700',
    marginLeft: 4,
  },
  content: {
    flexGrow: 1,
    padding: 16,
    paddingBottom: 24,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  houseName: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    flexShrink: 1,
  },
  renameLink: {
    marginLeft: 10,
    minHeight: 32,
    justifyContent: 'center',
  },
  renameLinkText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  renameBox: {
    gap: 10,
  },
  renameInput: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 12,
    color: colors.text,
    fontSize: 16,
  },
  codeLabel: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 14,
  },
  code: {
    color: colors.primary,
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 6,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 14,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  rowButton: {
    flex: 1,
  },
  button: {
    minHeight: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  outlineButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  outlineButtonText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '700',
  },
  filledButton: {
    backgroundColor: colors.primary,
  },
  filledButtonText: {
    color: colors.onPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 20,
    marginBottom: 8,
    marginLeft: 4,
  },
  spinner: {
    marginTop: 16,
  },
  list: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  memberRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  memberDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.avatarBackground,
  },
  avatarMe: {
    backgroundColor: colors.primarySoft,
  },
  avatarText: {
    color: colors.avatarText,
    fontSize: 13,
    fontWeight: '700',
  },
  avatarTextMe: {
    color: colors.primary,
  },
  memberName: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    marginLeft: 12,
  },
  ownerTag: {
    color: colors.textMuted,
    fontSize: 13,
  },
  retry: {
    alignSelf: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  inlineError: {
    color: colors.error,
    fontSize: 13,
  },
  centerText: {
    textAlign: 'center',
    marginBottom: 8,
  },
  spacer: {
    flex: 1,
    minHeight: 32,
  },
  leaveButton: {
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.surface,
  },
  leaveButtonText: {
    color: colors.error,
    fontSize: 15,
    fontWeight: '700',
  },
  logoutButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  logoutText: {
    color: colors.textMuted,
    fontSize: 15,
    fontWeight: '600',
  },
});
