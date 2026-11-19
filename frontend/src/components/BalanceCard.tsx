import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../constants/colors';
import { balanceLines, formatCents, type Balance } from '../utils/expenses';

const MAX_LINES = 4;

type Props = {
  balance: Balance;
};

// The big answer at the top of the Expenses tab: do I owe money, or am I owed?
export function BalanceCard({ balance }: Props) {
  const { net, people } = balance;
  const lines = balanceLines(balance);
  const shown = lines.slice(0, MAX_LINES);
  const hidden = lines.length - shown.length;

  const settled = people.length === 0;
  const label = settled ? 'All settled up' : net > 0 ? "You're owed" : net < 0 ? 'You owe' : "You're even overall";
  const amount = formatCents(Math.abs(net));
  const tone = net > 0 ? colors.avatarText : net < 0 ? colors.error : colors.textMuted;

  return (
    <View
      accessible
      accessibilityLabel={settled ? 'All settled up. Nobody owes anything.' : `${label} ${amount}. ${lines.join('. ')}`}
      style={styles.card}
    >
      {settled ? (
        <>
          <Text style={styles.settledMark}>✓</Text>
          <Text style={styles.settledTitle}>All settled up</Text>
          <Text style={styles.settledNote}>Nobody owes anything.</Text>
        </>
      ) : (
        <>
          <Text style={styles.label}>{label.toUpperCase()}</Text>
          <Text style={[styles.amount, { color: tone }]}>{amount}</Text>
          <View style={styles.lines}>
            {shown.map((line) => (
              <Text key={line} style={styles.line}>
                {line}
              </Text>
            ))}
            {hidden > 0 && <Text style={styles.lineMore}>and {hidden} more</Text>}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 22,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginBottom: 22,
  },
  label: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
  },
  amount: {
    fontSize: 42,
    fontWeight: '800',
    marginTop: 4,
    fontVariant: ['tabular-nums'],
  },
  lines: {
    marginTop: 12,
    alignItems: 'center',
  },
  line: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
  },
  lineMore: {
    color: colors.textFaint,
    fontSize: 12,
    marginTop: 2,
  },
  settledMark: {
    color: colors.online,
    fontSize: 34,
    fontWeight: '800',
  },
  settledTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    marginTop: 2,
  },
  settledNote: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 4,
  },
});
