import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../constants/colors';
import type { ExpenseResult } from '../hooks/useExpenses';
import { EXPENSE_TITLE_MAX_LENGTH, type NewExpense } from '../types/expenses';
import type { HouseholdMember } from '../types/messaging';
import {
  checkSplits,
  parseAmountToCents,
  sanitizeAmountInput,
  splitEqually,
  splitPreview,
} from '../utils/expenses';

type Props = {
  visible: boolean;
  onClose: () => void;
  // The signed-in user, who is always the one who paid.
  username: string;
  members: HouseholdMember[];
  onSubmit: (input: NewExpense) => Promise<ExpenseResult>;
};

const keyOf = (member: HouseholdMember) => member.username.trim().toLowerCase();
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// A bottom sheet for adding an expense: how much, what for, and who shares it. Everyone starts
// selected and the split is even, so the usual case takes an amount, a name, and one tap.
export function AddExpenseSheet({ visible, onClose, username, members, onSubmit }: Props) {
  const insets = useSafeAreaInsets();
  const [amountText, setAmountText] = useState('');
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  // Once the person has picked chips themselves, we stop selecting everyone for them.
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // You first, then the rest of the household in the order given.
  const me = members.find((member) => sameName(member.username, username));
  const ordered = me ? [me, ...members.filter((member) => member !== me)] : members;

  // Start fresh, with everyone selected, each time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    setAmountText('');
    setTitle('');
    setTouched(false);
    setSubmitting(false);
    setError(null);
    setSelected(members.map(keyOf));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // If the household finishes loading after the sheet opened, select everyone then.
  useEffect(() => {
    if (visible && !touched) setSelected(members.map(keyOf));
  }, [members, visible, touched]);

  const cents = parseAmountToCents(amountText);
  const chosen = ordered.filter((member) => selected.includes(keyOf(member)));
  const payerChosen = me !== undefined && chosen.includes(me);
  const missingIds = chosen.some((member) => !member.id);
  const canSubmit = cents !== null && title.trim().length > 0 && chosen.length > 0 && !missingIds && !submitting;

  function toggle(member: HouseholdMember) {
    setTouched(true);
    setError(null);
    setSelected((current) =>
      current.includes(keyOf(member)) ? current.filter((key) => key !== keyOf(member)) : [...current, keyOf(member)],
    );
  }

  async function handleSubmit() {
    if (!canSubmit || cents === null) return;
    const shares = splitEqually(
      cents,
      chosen.map((member) => member.id as string),
      payerChosen ? me?.id : undefined,
    );
    const nameById = new Map(chosen.map((member) => [member.id as string, member.username]));
    const splits = shares.map((share) => ({ ...share, username: nameById.get(share.userId) as string }));
    const problem = checkSplits(cents, splits);
    if (problem) {
      setError(problem);
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await onSubmit({ title, amountCents: cents, splits });
    setSubmitting(false);
    if (result.ok) onClose();
    else setError(result.error);
  }

  const preview =
    cents === null ? 'Enter an amount' : splitPreview(cents, chosen.length, payerChosen);

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlay}>
        <Pressable accessibilityLabel="Close" onPress={onClose} style={styles.backdrop} />
        <View style={[styles.sheet, { paddingBottom: 20 + insets.bottom }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.heading}>Add expense</Text>
            <Pressable accessibilityLabel="Close" accessibilityRole="button" hitSlop={10} onPress={onClose}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.amountRow}>
              <Text style={styles.currency}>$</Text>
              <TextInput
                accessibilityLabel="Amount"
                autoFocus
                inputMode="decimal"
                keyboardType="decimal-pad"
                maxLength={12}
                onChangeText={(text) => {
                  setAmountText(sanitizeAmountInput(text));
                  setError(null);
                }}
                placeholder="0.00"
                placeholderTextColor={colors.textFaint}
                style={styles.amountInput}
                value={amountText}
              />
            </View>

            <TextInput
              accessibilityLabel="What was it for"
              maxLength={EXPENSE_TITLE_MAX_LENGTH}
              onChangeText={(text) => {
                setTitle(text);
                setError(null);
              }}
              placeholder="What was it for? (groceries, rent…)"
              placeholderTextColor={colors.textFaint}
              returnKeyType="done"
              style={styles.titleInput}
              value={title}
            />

            <Text style={styles.label}>SPLIT BETWEEN</Text>
            <View style={styles.chips}>
              {ordered.map((member) => {
                const on = selected.includes(keyOf(member));
                return (
                  <Pressable
                    key={keyOf(member)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    onPress={() => toggle(member)}
                    style={[styles.chip, on && styles.chipOn]}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>
                      {on ? '✓ ' : ''}
                      {member === me ? 'Me' : member.username}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.preview, cents === null && styles.previewFaint]}>{preview}</Text>

            {missingIds && (
              <Text style={styles.problem}>
                This server doesn’t share roommates’ IDs yet, so an expense can’t be split here.
              </Text>
            )}
            {error && <Text style={styles.problem}>{error}</Text>}
          </ScrollView>

          <Pressable
            accessibilityRole="button"
            disabled={!canSubmit}
            onPress={handleSubmit}
            style={[styles.submit, !canSubmit && styles.submitDisabled]}
          >
            {submitting ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={styles.submitText}>Add expense</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(59, 42, 32, 0.4)',
  },
  sheet: {
    maxHeight: '92%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 22,
    paddingTop: 10,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heading: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  close: {
    color: colors.textFaint,
    fontSize: 18,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
    marginBottom: 10,
  },
  currency: {
    color: colors.textFaint,
    fontSize: 38,
    fontWeight: '700',
    marginRight: 4,
  },
  amountInput: {
    minWidth: 140,
    color: colors.text,
    fontSize: 46,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    paddingVertical: 4,
  },
  titleInput: {
    height: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 16,
  },
  label: {
    color: colors.textFaint,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginTop: 22,
    marginBottom: 10,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  chip: {
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: colors.surfaceMuted,
    marginRight: 8,
    marginBottom: 8,
  },
  chipOn: {
    backgroundColor: colors.primarySoft,
  },
  chipText: {
    color: colors.textMuted,
    fontSize: 14,
  },
  chipTextOn: {
    color: colors.primary,
    fontWeight: '700',
  },
  preview: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: 6,
    textAlign: 'center',
  },
  previewFaint: {
    color: colors.textFaint,
  },
  problem: {
    color: colors.error,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 10,
  },
  submit: {
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    marginTop: 16,
  },
  submitDisabled: {
    backgroundColor: colors.primaryDisabled,
  },
  submitText: {
    color: colors.onPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
});
