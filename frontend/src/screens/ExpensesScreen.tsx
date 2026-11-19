import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { AddExpenseSheet } from '../components/AddExpenseSheet';
import { BalanceCard } from '../components/BalanceCard';
import { ExpenseRow } from '../components/ExpenseRow';
import { USING_MOCK } from '../config';
import { colors } from '../constants/colors';
import { useExpenses } from '../hooks/useExpenses';
import { getMembers } from '../services/messagingApi';
import type { HouseholdMember } from '../types/messaging';
import { computeBalances, groupByDay } from '../utils/expenses';

type Props = {
  username: string;
  token: string;
  inviteCode: string;
  // The server says the session is no longer valid.
  onSessionExpired: () => void;
};

// Shared household expenses: the balance up top, then every expense newest first, and a button to add one.
export function ExpensesScreen({ username, token, inviteCode, onSessionExpired }: Props) {
  const { expenses, loading, loadError, refreshing, reload, refresh, create } = useExpenses(
    token,
    inviteCode,
    onSessionExpired,
  );
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // The roommates to split with. Reloaded each time the sheet opens, in case someone has joined.
  async function loadMembers() {
    try {
      setMembers(await getMembers(token, inviteCode));
    } catch {
      // keep whatever was loaded before
    }
  }

  useEffect(() => {
    let cancelled = false;
    getMembers(token, inviteCode)
      .then((loaded) => {
        if (!cancelled) setMembers(loaded);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token, inviteCode]);

  const balance = useMemo(() => computeBalances(expenses, username), [expenses, username]);
  const groups = useMemo(() => groupByDay(expenses), [expenses]);

  function openSheet() {
    loadMembers();
    setSheetOpen(true);
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <Text style={styles.headerIconText}>R</Text>
        </View>
        <Text style={styles.headerTitle}>Expenses</Text>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl colors={[colors.primary]} onRefresh={reload} refreshing={refreshing} tintColor={colors.primary} />}
        >
          {loadError && (
            <Pressable onPress={refresh}>
              <Text style={styles.banner}>{loadError} (tap to retry)</Text>
            </Pressable>
          )}

          {loading && (
            <View style={styles.centered}>
              <ActivityIndicator color={colors.primary} />
            </View>
          )}

          {!loading && expenses.length === 0 && !loadError && (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No expenses yet</Text>
              <Text style={styles.emptyNote}>
                Add the first one: groceries, rent, Wi-Fi. We’ll keep track of who owes what.
              </Text>
            </View>
          )}

          {expenses.length > 0 && <BalanceCard balance={balance} />}

          {groups.map((group) => (
            <View key={group.key} style={styles.group}>
              <Text style={styles.groupLabel}>{group.label.toUpperCase()}</Text>
              <View style={styles.groupCard}>
                {group.expenses.map((expense, index) => (
                  <View key={expense.id} style={index > 0 && styles.divided}>
                    <ExpenseRow
                      expanded={expandedId === expense.id}
                      expense={expense}
                      me={username}
                      onPress={() => setExpandedId((current) => (current === expense.id ? null : expense.id))}
                    />
                  </View>
                ))}
              </View>
            </View>
          ))}

          {USING_MOCK && <Text style={styles.footnote}>Fake-data mode: expenses are kept on this device only.</Text>}
        </ScrollView>
      </KeyboardAvoidingView>

      <Pressable accessibilityLabel="Add expense" accessibilityRole="button" onPress={openSheet} style={styles.fab}>
        <Text style={styles.fabText}>+</Text>
      </Pressable>

      <AddExpenseSheet
        members={members}
        onClose={() => setSheetOpen(false)}
        onSubmit={create}
        username={username}
        visible={sheetOpen}
      />
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
    // Room at the bottom so the last expense isn't hidden behind the + button.
    paddingBottom: 110,
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
    padding: 28,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  emptyNote: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 8,
  },
  group: {
    marginBottom: 18,
  },
  groupLabel: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 8,
    marginLeft: 4,
  },
  groupCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
  },
  divided: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footnote: {
    color: colors.textFaint,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 4,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 22,
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    // A soft shadow so the button floats above the list.
    shadowColor: '#3B2A20',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabText: {
    color: colors.onPrimary,
    fontSize: 32,
    fontWeight: '500',
    lineHeight: 36,
  },
});
