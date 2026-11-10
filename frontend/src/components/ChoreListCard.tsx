import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../constants/colors';
import { CHORE_TEXT_MAX_LENGTH, ChoreList } from '../types/messaging';

type Props = {
  list: ChoreList;
  onToggle: (itemId: string, isDone: boolean) => void;
  onDeleteItem: (itemId: string) => void;
  onDeleteList: () => void;
  // Resolves to an error message, or null when the chore was added.
  onAddItem: (text: string) => Promise<string | null>;
};

export function ChoreListCard({ list, onToggle, onDeleteItem, onDeleteList, onAddItem }: Props) {
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const done = list.items.filter((i) => i.isDone).length;

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed || adding) return;
    setAdding(true);
    setError(null);
    const problem = await onAddItem(trimmed);
    setAdding(false);
    if (problem) setError(problem);
    else setText('');
  }

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleGroup}>
          <Text style={styles.cardTitle} numberOfLines={1}>{list.title}</Text>
          <Text style={styles.cardSub}>
            {list.items.length === 0 ? 'No chores yet' : `${done} of ${list.items.length} done`}
            {list.assignee ? '' : ' · whole house'}
          </Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${list.title}`} onPress={onDeleteList} hitSlop={8}>
          <Text style={styles.deleteText}>Delete list</Text>
        </Pressable>
      </View>

      {list.items.map((item) => (
        <View key={item.id} style={styles.itemRow}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: item.isDone }}
            accessibilityLabel={item.text}
            onPress={() => onToggle(item.id, !item.isDone)}
            style={styles.itemMain}
          >
            <View style={[styles.checkbox, item.isDone && styles.checkboxDone]}>
              {item.isDone && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <View style={styles.itemTextGroup}>
              <Text style={[styles.itemText, item.isDone && styles.itemTextDone]}>{item.text}</Text>
              {item.isDone && item.doneBy && <Text style={styles.doneBy}>Done by {item.doneBy}</Text>}
            </View>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${item.text}`} onPress={() => onDeleteItem(item.id)} hitSlop={8}>
            <Text style={styles.removeText}>✕</Text>
          </Pressable>
        </View>
      ))}

      <View style={styles.addRow}>
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={submit}
          placeholder="Add a chore"
          placeholderTextColor={colors.textFaint}
          maxLength={CHORE_TEXT_MAX_LENGTH}
          returnKeyType="done"
          style={styles.input}
        />
        <Pressable
          accessibilityRole="button"
          onPress={submit}
          disabled={!text.trim() || adding}
          style={[styles.addButton, (!text.trim() || adding) && styles.addButtonDisabled]}
        >
          <Text style={styles.addButtonText}>Add</Text>
        </Pressable>
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 14,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  cardTitleGroup: { flex: 1, marginRight: 10 },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  cardSub: { color: colors.textFaint, fontSize: 12, marginTop: 2 },
  deleteText: { color: colors.error, fontSize: 12, fontWeight: '600' },
  itemRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  itemMain: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  checkboxDone: { backgroundColor: colors.primary },
  checkmark: { color: colors.onPrimary, fontSize: 13, fontWeight: '800' },
  itemTextGroup: { flex: 1 },
  itemText: { color: colors.text, fontSize: 15 },
  itemTextDone: { color: colors.textFaint, textDecorationLine: 'line-through' },
  doneBy: { color: colors.textFaint, fontSize: 11, marginTop: 1 },
  removeText: { color: colors.textFaint, fontSize: 14, paddingHorizontal: 8 },
  addRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  input: {
    flex: 1,
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.surfaceMuted,
    color: colors.text,
    fontSize: 14,
  },
  addButton: {
    marginLeft: 8,
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonDisabled: { backgroundColor: colors.primaryDisabled },
  addButtonText: { color: colors.onPrimary, fontSize: 13, fontWeight: '700' },
  error: { color: colors.error, fontSize: 12, marginTop: 6 },
});
