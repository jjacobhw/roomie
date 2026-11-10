import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { ChoreListCard } from '../components/ChoreListCard';
import { colors } from '../constants/colors';
import { useChores } from '../hooks/useChores';
import { getMembers } from '../services/messagingApi';
import { HouseholdMember } from '../types/messaging';

type Props = {
  username: string;
  token: string;
  inviteCode: string;
  householdName: string | null;
  onBack: () => void;
  onSessionExpired: () => void;
};

export function ChoresScreen({ username, token, inviteCode, householdName, onBack, onSessionExpired }: Props) {
  const { lists, loading, loadError, refresh, toggleItem, removeItem, removeList, addItem, addList } = useChores(
    token,
    inviteCode,
    onSessionExpired,
  );
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [picking, setPicking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMembers(token, inviteCode)
      .then((m) => !cancelled && setMembers(m))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token, inviteCode]);

  async function report(result: Promise<{ ok: boolean; error?: string }>) {
    const r = await result;
    setMessage(r.ok ? null : r.error ?? 'Something went wrong');
  }

  async function create(assignee: string | null) {
    setPicking(false);
    await report(addList({ assignee }));
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onBack} style={styles.headerButton}>
          <Text style={styles.headerButtonText}>Chat</Text>
        </Pressable>
        <View style={styles.headerTitleGroup}>
          <Text style={styles.headerTitle} numberOfLines={1}>Chores</Text>
          <Text style={styles.headerSub} numberOfLines={1}>{householdName || 'Your household'}</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={() => setPicking((p) => !p)} style={styles.headerButton}>
          <Text style={styles.headerButtonText}>New list</Text>
        </Pressable>
      </View>

      {picking && (
        <View style={styles.picker}>
          <Text style={styles.pickerLabel}>WHO IS THIS LIST FOR?</Text>
          <View style={styles.pills}>
            {[username, ...members.map((m) => m.username).filter((n) => n !== username)].map((name) => (
              <Pressable key={name} onPress={() => create(name)} style={styles.pill}>
                <Text style={styles.pillText}>{name === username ? 'Me' : name}</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => create(null)} style={styles.pill}>
              <Text style={styles.pillText}>Whole house</Text>
            </Pressable>
          </View>
        </View>
      )}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {(loadError || message) && (
            <Pressable onPress={() => { setMessage(null); refresh(); }}>
              <Text style={styles.error}>{message ?? loadError} (tap to retry)</Text>
            </Pressable>
          )}
          {!loadError && lists.length === 0 && (
            <Text style={styles.empty}>No chore lists yet. Tap “New list” to make one.</Text>
          )}
          {lists.map((list) => (
            <ChoreListCard
              key={list.id}
              list={list}
              onToggle={(itemId, isDone) => report(toggleItem(list.id, itemId, isDone, username))}
              onDeleteItem={(itemId) => report(removeItem(list.id, itemId))}
              onDeleteList={() => report(removeList(list.id))}
              onAddItem={async (text) => {
                const r = await addItem(list.id, text);
                return r.ok ? null : r.error;
              }}
            />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  header: {
    height: 72,
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitleGroup: { flex: 1, marginHorizontal: 12 },
  headerTitle: { color: colors.text, fontSize: 19, fontWeight: '700' },
  headerSub: { color: colors.textFaint, fontSize: 12, marginTop: 2 },
  headerButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: colors.primarySoft,
  },
  headerButtonText: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  picker: { padding: 18, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  pickerLabel: { color: colors.textFaint, fontSize: 9, fontWeight: '700', letterSpacing: 1, marginBottom: 8 },
  pills: { flexDirection: 'row', flexWrap: 'wrap' },
  pill: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
    marginRight: 8,
    marginBottom: 8,
  },
  pillText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 18, paddingBottom: 32 },
  error: { color: colors.error, fontSize: 13, textAlign: 'center', marginBottom: 12 },
  empty: { color: colors.textFaint, fontSize: 13, textAlign: 'center', marginTop: 24 },
});
