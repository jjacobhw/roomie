import { useRef, useState } from 'react';
import {
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
import { CHORE_ITEM_MAX_LENGTH, ChoreList } from '../types/chores';
import { addChoreItem, choreProgress, toggleChoreItem } from '../utils/chores';
import { sampleChoreLists } from '../utils/sampleChores';

type Props = {
  username: string;
};

// Who a list belongs to, as shown on its badge.
function assigneeLabel(list: ChoreList, username: string): string {
  if (list.assignee === null) return 'Whole house';
  return list.assignee === username ? 'You' : list.assignee;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// The household's chore lists. For now they are sample data kept in this screen's state,
// so checking things off works but nothing is saved or shared yet.
export function ChoresScreen({ username }: Props) {
  const [lists, setLists] = useState<ChoreList[]>(() => sampleChoreLists(username));
  // What's typed in each list's "add a chore" box, by list id.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const nextId = useRef(1);

  function toggle(itemId: string, isDone: boolean) {
    setLists((current) => toggleChoreItem(current, itemId, isDone, username, new Date().toISOString()));
  }

  function addItem(listId: string) {
    const text = drafts[listId] ?? '';
    const updated = addChoreItem(lists, listId, text, `local-${nextId.current++}`, new Date().toISOString());
    if (updated === lists) return; // blank, too long, or unknown list
    setLists(updated);
    setDrafts((current) => ({ ...current, [listId]: '' }));
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
                    onPress={() => toggle(item.id, !item.isDone)}
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
                    onSubmitEditing={() => addItem(list.id)}
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
                    onPress={() => addItem(list.id)}
                    style={[styles.addButton, draft.trim() === '' && styles.addButtonDisabled]}
                  >
                    <Text style={styles.addButtonText}>+</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}

          <Text style={styles.footnote}>
            Sample chores — not connected to the server yet, so nothing is saved or shared.
          </Text>
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
});
