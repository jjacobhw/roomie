import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors } from '../constants/colors';
import { USING_MOCK } from '../config';
import { useChores } from '../hooks/useChores';
import { CHORE_ITEM_MAX_LENGTH, CHORE_TITLE_MAX_LENGTH, ChoreList } from '../types/chores';
import { choreProgress } from '../utils/chores';

type Props = {
  username: string;
  token: string;
  inviteCode: string;
  // The server says the session is no longer valid.
  onSessionExpired: () => void;
};

// Who a list belongs to, as shown on its badge.
function assigneeLabel(list: ChoreList, username: string): string {
  if (list.assignee === null) return 'Whole house';
  return list.assignee === username ? 'You' : list.assignee;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// The household's chore lists, loaded from the server and refreshed every few seconds so a
// roommate's checkmark shows up here too.
export function ChoresScreen({ username, token, inviteCode, onSessionExpired }: Props) {
  const { lists, loading, loadError, toggle, addItem, createList } = useChores(
    token,
    inviteCode,
    username,
    onSessionExpired,
  );
  // What's typed in each list's "add a chore" box, by list id.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // The "new list" form.
  const [newTitle, setNewTitle] = useState('');
  const [wholeHouse, setWholeHouse] = useState(false);
  const [creating, setCreating] = useState(false);
  // The reason the last change failed (e.g. the server was unreachable), until the next one.
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleToggle(itemId: string, isDone: boolean) {
    setActionError(null);
    const result = await toggle(itemId, isDone);
    if (!result.ok) setActionError(result.error);
  }

  async function handleAddItem(listId: string) {
    const text = (drafts[listId] ?? '').trim();
    if (text === '') return;
    setActionError(null);
    const result = await addItem(listId, text);
    if (result.ok) {
      setDrafts((current) => ({ ...current, [listId]: '' }));
    } else {
      setActionError(result.error); // the text stays in the box so it can be sent again
    }
  }

  async function handleCreateList() {
    if (creating) return;
    setCreating(true);
    setActionError(null);
    // Leaving assignee out lets the server assign the list to you; null means the whole house.
    const result = await createList({ title: newTitle, ...(wholeHouse ? { assignee: null } : {}) });
    if (result.ok) {
      setNewTitle('');
      setWholeHouse(false);
    } else {
      setActionError(result.error);
    }
    setCreating(false);
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <Text style={styles.headerIconText}>R</Text>
        </View>
        <Text style={styles.headerTitle}>Chores</Text>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {(actionError ?? loadError) && <Text style={styles.banner}>{actionError ?? loadError}</Text>}

          {loading && (
            <View style={styles.centered}>
              <ActivityIndicator color={colors.primary} />
            </View>
          )}

          {!loading && lists.length === 0 && !loadError && (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No chore lists yet</Text>
              <Text style={styles.emptyNote}>Create one below, for yourself or for the whole house.</Text>
            </View>
          )}

          {lists.map((list) => {
            const { done, total } = choreProgress(list);
            const draft = drafts[list.id] ?? '';
            return (
              <View key={list.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>{list.title}</Text>
                  <View style={[styles.badge, list.assignee === null && styles.badgeHouse]}>
                    <Text style={[styles.badgeText, list.assignee === null && styles.badgeTextHouse]}>
                      {assigneeLabel(list, username)}
                    </Text>
                  </View>
                </View>

                <Text style={styles.progressText}>
                  {total === 0 ? 'No chores yet' : `${done} of ${total} done`}
                </Text>
                <View style={styles.progressTrack}>
                  <View
                    style={[styles.progressFill, { width: total === 0 ? '0%' : `${(done / total) * 100}%` }]}
                  />
                </View>

                {list.items.map((item) => (
                  <Pressable
                    key={item.id}
                    accessibilityLabel={`${item.text}, ${item.isDone ? 'done' : 'not done'}`}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: item.isDone }}
                    onPress={() => handleToggle(item.id, !item.isDone)}
                    style={styles.itemRow}
                  >
                    <View style={[styles.checkbox, item.isDone && styles.checkboxChecked]}>
                      {item.isDone && <Text style={styles.checkmark}>✓</Text>}
                    </View>
                    <View style={styles.itemCopy}>
                      <Text style={[styles.itemText, item.isDone && styles.itemTextDone]}>{item.text}</Text>
                      {item.isDone && item.doneBy && item.doneAt && (
                        <Text style={styles.itemMeta}>
                          Done by {item.doneBy === username ? 'you' : item.doneBy} at {formatTime(item.doneAt)}
                        </Text>
                      )}
                    </View>
                  </Pressable>
                ))}

                <View style={styles.addRow}>
                  <TextInput
                    accessibilityLabel={`Add a chore to ${list.title}`}
                    maxLength={CHORE_ITEM_MAX_LENGTH}
                    onChangeText={(text) => setDrafts((current) => ({ ...current, [list.id]: text }))}
                    onSubmitEditing={() => handleAddItem(list.id)}
                    placeholder="Add a chore..."
                    placeholderTextColor={colors.textFaint}
                    returnKeyType="done"
                    style={styles.addInput}
                    value={draft}
                  />
                  <Pressable
                    accessibilityLabel="Add chore"
                    accessibilityRole="button"
                    disabled={draft.trim() === ''}
                    onPress={() => handleAddItem(list.id)}
                    style={[styles.addButton, draft.trim() === '' && styles.addButtonDisabled]}
                  >
                    <Text style={styles.addButtonText}>+</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}

          <View style={styles.createCard}>
            <Text style={styles.createLabel}>NEW LIST</Text>
            <TextInput
              accessibilityLabel="New list name"
              maxLength={CHORE_TITLE_MAX_LENGTH}
              onChangeText={setNewTitle}
              onSubmitEditing={handleCreateList}
              placeholder="List name (optional)"
              placeholderTextColor={colors.textFaint}
              returnKeyType="done"
              style={styles.addInput}
              value={newTitle}
            />
            <View style={styles.chipRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: !wholeHouse }}
                onPress={() => setWholeHouse(false)}
                style={[styles.chip, !wholeHouse && styles.chipSelected]}
              >
                <Text style={[styles.chipText, !wholeHouse && styles.chipTextSelected]}>Mine</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: wholeHouse }}
                onPress={() => setWholeHouse(true)}
                style={[styles.chip, wholeHouse && styles.chipSelected]}
              >
                <Text style={[styles.chipText, wholeHouse && styles.chipTextSelected]}>Whole house</Text>
              </Pressable>
            </View>
            <Pressable
              accessibilityRole="button"
              disabled={creating}
              onPress={handleCreateList}
              style={[styles.createButton, creating && styles.addButtonDisabled]}
            >
              <Text style={styles.createButtonText}>Create list</Text>
            </Pressable>
          </View>

          {USING_MOCK && (
            <Text style={styles.footnote}>Fake-data mode: chores are kept on this device only.</Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  root: {
    flex: 1,
    backgroundColor: colors.background,
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
  headerTitle: {
    flex: 1,
    marginLeft: 12,
    color: colors.text,
    fontSize: 19,
    fontWeight: '700',
  },
  content: {
    padding: 18,
    paddingBottom: 28,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
    marginRight: 10,
  },
  badge: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: colors.primarySoft,
  },
  badgeHouse: {
    backgroundColor: colors.avatarBackground,
  },
  badgeText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '700',
  },
  badgeTextHouse: {
    color: colors.avatarText,
  },
  progressText: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 8,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surfaceMuted,
    marginTop: 6,
    marginBottom: 8,
    overflow: 'hidden',
  },
  progressFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.online,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.textFaint,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  checkboxChecked: {
    borderColor: colors.online,
    backgroundColor: colors.online,
  },
  checkmark: {
    color: colors.onPrimary,
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 16,
  },
  itemCopy: {
    flex: 1,
  },
  itemText: {
    color: colors.text,
    fontSize: 15,
  },
  itemTextDone: {
    color: colors.textFaint,
    textDecorationLine: 'line-through',
  },
  itemMeta: {
    color: colors.textFaint,
    fontSize: 11,
    marginTop: 2,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  addInput: {
    flex: 1,
    height: 42,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 21,
    backgroundColor: colors.surfaceMuted,
    color: colors.text,
    fontSize: 14,
  },
  addButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
    backgroundColor: colors.primary,
  },
  addButtonDisabled: {
    backgroundColor: colors.primaryDisabled,
  },
  addButtonText: {
    color: colors.onPrimary,
    fontSize: 24,
    fontWeight: '600',
    lineHeight: 26,
  },
  footnote: {
    color: colors.textFaint,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 4,
  },
  centered: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  banner: {
    color: colors.error,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 12,
  },
  emptyCard: {
    alignItems: 'center',
    padding: 24,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    marginBottom: 16,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  emptyNote: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
  },
  createCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 16,
  },
  createLabel: {
    color: colors.textFaint,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 10,
  },
  chipRow: {
    flexDirection: 'row',
    marginTop: 10,
    marginBottom: 12,
  },
  chip: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: colors.surfaceMuted,
    marginRight: 8,
  },
  chipSelected: {
    backgroundColor: colors.primarySoft,
  },
  chipText: {
    color: colors.textMuted,
    fontSize: 13,
  },
  chipTextSelected: {
    color: colors.primary,
    fontWeight: '700',
  },
  createButton: {
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  createButtonText: {
    color: colors.onPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
});

