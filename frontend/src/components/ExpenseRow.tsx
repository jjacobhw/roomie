import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../constants/colors';
import type { Expense } from '../types/expenses';
import { describeShare, expenseSubtitle, formatCents } from '../utils/expenses';
import { initial } from '../utils/members';
import { ChevronDownIcon } from './icons';

type Props = {
  expense: Expense;
  me: string;
  expanded: boolean;
  onPress: () => void;
  // Shown (inside the opened row) only for an expense you added yourself.
  canDelete?: boolean;
  deleting?: boolean;
  onDelete?: () => void;
  // Skip the animations when the phone asks for less motion.
  reduceMotion?: boolean;
};

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
// The native driver runs animations off the JavaScript thread; the web doesn't have one.
const useNativeDriver = Platform.OS !== 'web';

// One expense: who paid, what for, and what it means for you. Tap to open it and see everyone's share;
// the arrow on the right turns to show that it opens and closes.
export function ExpenseRow({ expense, me, expanded, onPress, canDelete, deleting, onDelete, reduceMotion }: Props) {
  const share = describeShare(expense, me);
  const tone = share.kind === 'lent' ? colors.avatarText : share.kind === 'owe' ? colors.error : colors.textFaint;
  const amountText = share.cents > 0 ? formatCents(share.cents) : null;

  // 0 = closed (arrow points down), 1 = open (arrow points up).
  const turn = useRef(new Animated.Value(expanded ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(turn, {
      toValue: expanded ? 1 : 0,
      duration: reduceMotion ? 0 : 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver,
    }).start();
  }, [expanded, reduceMotion, turn]);
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityHint={expanded ? 'Hides who owes what' : 'Shows who owes what'}
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

        <Animated.View style={[styles.chevron, { transform: [{ rotate }] }]} testID="expense-chevron">
          <ChevronDownIcon color={colors.textFaint} size={14} />
        </Animated.View>
      </View>

      {expanded && (
        <Shares
          canDelete={canDelete}
          deleting={deleting}
          expense={expense}
          me={me}
          onDelete={onDelete}
          reduceMotion={reduceMotion}
        />
      )}
    </Pressable>
  );
}

// The opened part: everyone's share, and (for your own expense) a way to delete it.
// Fades and slides in a little when it appears.
function Shares({
  expense,
  me,
  canDelete,
  deleting,
  onDelete,
  reduceMotion,
}: Pick<Props, 'expense' | 'me' | 'canDelete' | 'deleting' | 'onDelete' | 'reduceMotion'>) {
  const appear = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(appear, {
      toValue: 1,
      duration: reduceMotion ? 0 : 180,
      easing: Easing.out(Easing.quad),
      useNativeDriver,
    }).start();
  }, [appear, reduceMotion]);
  const translateY = appear.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] });

  return (
    <Animated.View style={[styles.splits, { opacity: appear, transform: [{ translateY }] }]}>
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

      {canDelete && (
        <Pressable
          accessibilityLabel={`Delete ${expense.title}`}
          accessibilityRole="button"
          disabled={deleting}
          hitSlop={8}
          onPress={onDelete}
          style={styles.deleteButton}
        >
          <Text style={[styles.deleteText, deleting && styles.deleteTextBusy]}>
            {deleting ? 'Deleting…' : 'Delete expense'}
          </Text>
        </Pressable>
      )}
    </Animated.View>
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
  right: {
    alignItems: 'flex-end',
    minWidth: 72,
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
  chevron: {
    alignSelf: 'center',
    marginLeft: 10,
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
  deleteButton: {
    alignSelf: 'flex-end',
    marginTop: 10,
    paddingVertical: 4,
  },
  deleteText: {
    color: colors.error,
    fontSize: 13,
    fontWeight: '600',
  },
  deleteTextBusy: {
    color: colors.textFaint,
  },
});
