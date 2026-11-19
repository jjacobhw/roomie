import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../constants/colors';
import type { Expense } from '../types/expenses';
import { describeShare, expenseSubtitle, formatCents } from '../utils/expenses';
import { initial } from '../utils/members';

type Props = {
  expense: Expense;
  me: string;
  expanded: boolean;
  onPress: () => void;
};

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// One expense: who paid, what for, and what it means for you. Tap to see everyone's share.
export function ExpenseRow({ expense, me, expanded, onPress }: Props) {
  const share = describeShare(expense, me);
  const tone = share.kind === 'lent' ? colors.avatarText : share.kind === 'owe' ? colors.error : colors.textFaint;
  const amountText = share.cents > 0 ? formatCents(share.cents) : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={`${expense.title}, ${expenseSubtitle(expense, me)}, ${amountText ? `${share.label} ${amountText}` : share.label}`}
      onPress={onPress}
      style={styles.row}
    >
      <View style={styles.top}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial(expense.paidByUsername)}</Text>
        </View>

        <View style={styles.middle}>
          <Text numberOfLines={expanded ? undefined : 1} style={styles.title}>
            {expense.title}
          </Text>
          <Text style={styles.subtitle}>{expenseSubtitle(expense, me)}</Text>
        </View>

        <View style={styles.right}>
          {amountText && <Text style={[styles.amount, { color: tone }]}>{amountText}</Text>}
          <Text style={[styles.shareLabel, { color: tone }]}>{share.label}</Text>
        </View>
      </View>

      {expanded && (
        <View style={styles.splits}>
          {expense.splits.map((split) => {
            const isPayer = sameName(split.username, expense.paidByUsername);
            const status = isPayer ? 'paid the bill' : split.isPaid ? 'paid back' : 'not paid yet';
            return (
              <View key={split.userId} style={styles.splitRow}>
                <Text style={styles.splitName}>
                  {sameName(split.username, me) ? 'You' : split.username} · {formatCents(split.amountCents)}
                </Text>
                <Text numberOfLines={1} style={[styles.splitStatus, !isPayer && !split.isPaid && styles.splitOwes]}>
                  {status}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: 12,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.avatarBackground,
    marginRight: 12,
  },
  avatarText: {
    color: colors.avatarText,
    fontSize: 15,
    fontWeight: '700',
  },
  middle: {
    flex: 1,
    marginRight: 10,
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  // Under the whole row, lined up with the title, so each share has room on one line.
  splits: {
    marginTop: 10,
    marginLeft: 52,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  splitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  splitName: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
  },
  splitStatus: {
    flexShrink: 0,
    marginLeft: 10,
    color: colors.textFaint,
    fontSize: 12,
  },
  splitOwes: {
    color: colors.error,
    fontWeight: '600',
  },
  right: {
    alignItems: 'flex-end',
    minWidth: 78,
  },
  amount: {
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  shareLabel: {
    fontSize: 11,
    marginTop: 2,
  },
});
