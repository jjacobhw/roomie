// Expenses tab: the money logic and the fake-data API behind it.
// Runs the real frontend code (frontend/src/utils/expenses.ts and the fake-data API layer), so no
// server, database or phone is needed.
import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

// The frontend's imports leave off ".ts" (tsc allows that, plain Node doesn't); this adds it.
register(
  'data:text/javascript,' + encodeURIComponent(`
    export async function resolve(specifier, context, next) {
      try {
        return await next(specifier, context);
      } catch (error) {
        const fromTs = context.parentURL && context.parentURL.endsWith('.ts');
        if (fromTs && /^\\.{1,2}\\//.test(specifier) && !/\\.[a-z]+$/i.test(specifier)) {
          return next(specifier + '.ts', context);
        }
        throw error;
      }
    }
  `)
);

const {
  addExpense, balanceLines, checkSplits, computeBalances, describeShare, expenseSubtitle,
  formatCents, groupByDay, parseAmountToCents, splitEqually, splitPreview,
} = await import('../frontend/src/utils/expenses.ts');
const api = await import('../frontend/src/services/mockApi.ts');

// ---- helpers ---------------------------------------------------------------------------------

let counter = 0;
const split = (username, amountCents, isPaid = false) => ({ userId: `id-${username}`, username, amountCents, isPaid });
const expense = (paidByUsername, amountCents, splits, createdAt = '2026-11-18T12:00:00.000Z') => ({
  id: `e${counter++}`, title: 'Thing', amountCents, createdAt, paidByUsername, splits,
});
const sumOf = (shares) => shares.reduce((total, s) => total + s.amountCents, 0);

// ---- parseAmountToCents / formatCents -----------------------------------------------------------

test('expenses parseAmountToCents turns typed amounts into whole cents', () => {
  const valid = {
    '12': 1200, '12.5': 1250, '12.50': 1250, '$12.50': 1250, '$ 12.50': 1250, '1,234.5': 123450,
    '.5': 50, '0.99': 99, '12.': 1200, '  7 ': 700, '0.01': 1, '999999.99': 99999999,
  };
  for (const [text, cents] of Object.entries(valid)) assert.equal(parseAmountToCents(text), cents, `"${text}"`);
});

test('expenses parseAmountToCents rejects anything that is not a usable amount', () => {
  for (const text of ['', ' ', 'abc', '12.345', '0', '0.00', '-5', '1e3', '12,34', '1,2,3', '1,23,456', '1000000', '$', '.', '1 2', '12..5']) {
    assert.equal(parseAmountToCents(text), null, `"${text}"`);
  }
});

test('expenses formatCents shows dollars with separators, and formatting then parsing returns the same cents', () => {
  assert.equal(formatCents(0), '$0.00');
  assert.equal(formatCents(5), '$0.05');
  assert.equal(formatCents(1250), '$12.50');
  assert.equal(formatCents(123456789), '$1,234,567.89');
  assert.equal(formatCents(-1250), '-$12.50');
  assert.equal(formatCents(Number.NaN), '$0.00');
  for (let cents = 1; cents <= 99999999; cents = Math.ceil(cents * 1.37) + 1) {
    assert.equal(parseAmountToCents(formatCents(cents)), cents, `${cents}`);
  }
});

// ---- splitEqually / splitPreview ----------------------------------------------------------------

test('expenses splitEqually gives everyone the same share when the total divides evenly', () => {
  assert.deepEqual(splitEqually(6000, ['a', 'b', 'c']), [
    { userId: 'a', amountCents: 2000 }, { userId: 'b', amountCents: 2000 }, { userId: 'c', amountCents: 2000 },
  ]);
});

test('expenses splitEqually makes the payer cover leftover cents, so nobody else pays more than their share', () => {
  const shares = splitEqually(1000, ['a', 'b', 'c'], 'b');
  assert.deepEqual(shares, [
    { userId: 'a', amountCents: 333 }, { userId: 'b', amountCents: 334 }, { userId: 'c', amountCents: 333 },
  ]);
  // Without a payer in the group the first people take the extra cents.
  assert.deepEqual(splitEqually(1000, ['a', 'b', 'c']).map((s) => s.amountCents), [334, 333, 333]);
  assert.deepEqual(splitEqually(1000, ['a', 'b', 'c'], 'zzz').map((s) => s.amountCents), [334, 333, 333]);
});

test('expenses splitEqually always adds up to the total, for every total and group size', () => {
  for (let total = 1; total <= 250; total++) {
    for (let people = 1; people <= 8; people++) {
      const ids = Array.from({ length: people }, (_, i) => `p${i}`);
      for (const payer of [undefined, 'p0', `p${people - 1}`]) {
        const shares = splitEqually(total, ids, payer);
        assert.equal(sumOf(shares), total, `total ${total}, ${people} people, payer ${payer}`);
        assert.ok(shares.every((s) => Number.isInteger(s.amountCents) && s.amountCents >= 0));
        const floor = Math.floor(total / people);
        if (payer) for (const s of shares) if (s.userId !== payer) assert.equal(s.amountCents, floor);
      }
    }
  }
});

test('expenses splitEqually handles one person, nobody, and repeated people', () => {
  assert.deepEqual(splitEqually(999, ['a']), [{ userId: 'a', amountCents: 999 }]);
  assert.deepEqual(splitEqually(999, []), []);
  assert.deepEqual(splitEqually(900, ['a', 'a', 'b']), [{ userId: 'a', amountCents: 450 }, { userId: 'b', amountCents: 450 }]);
});

test('expenses splitPreview explains the split in one line', () => {
  assert.equal(splitPreview(6000, 3, true), 'Everyone pays $20.00');
  assert.equal(splitPreview(1000, 3, true), 'Others pay $3.33 each · you cover the rest');
  assert.equal(splitPreview(1000, 3, false), 'Each pays about $3.33');
  assert.equal(splitPreview(1000, 1, true), 'Just you: nobody owes anything');
  assert.equal(splitPreview(1000, 1, false), 'They pay $10.00');
  assert.equal(splitPreview(1000, 0, true), 'Pick at least one person');
});

test('expenses checkSplits accepts shares that add up and explains why others are refused', () => {
  assert.equal(checkSplits(1000, [{ userId: 'a', username: 'a', amountCents: 400 }, { userId: 'b', username: 'b', amountCents: 600 }]), null);
  assert.match(checkSplits(1000, []), /at least one person/);
  assert.match(checkSplits(1000, [{ userId: 'a', username: 'a', amountCents: 999 }]), /add up/);
  assert.match(checkSplits(1000, [{ userId: 'a', username: 'a', amountCents: 10.5 }]), /whole number/);
  assert.match(checkSplits(1000, [{ userId: 'a', username: 'a', amountCents: -5 }, { userId: 'b', username: 'b', amountCents: 1005 }]), /whole number/);
});

// ---- balances ------------------------------------------------------------------------------------

const house = () => [
  expense('Alex', 6000, [split('Alex', 2000, true), split('Sam', 2000), split('Taylor', 2000)]),
  expense('Sam', 3000, [split('Sam', 1000, true), split('Alex', 1000), split('Taylor', 1000)]),
];

test('expenses computeBalances adds up who owes you, who you owe, and the net', () => {
  const alex = computeBalances(house(), 'Alex');
  assert.deepEqual(alex.people, [{ username: 'Taylor', cents: 2000 }, { username: 'Sam', cents: 1000 }]); // Sam: +2000 -1000
  assert.equal(alex.net, 3000);

  const taylor = computeBalances(house(), 'Taylor');
  assert.deepEqual(taylor.people, [{ username: 'Alex', cents: -2000 }, { username: 'Sam', cents: -1000 }]);
  assert.equal(taylor.net, -3000);
});

test('expenses computeBalances ignores paid shares and the payer\'s own share, and matches names ignoring case', () => {
  const list = [expense('Alex', 6000, [split('Alex', 2000, true), split('Sam', 2000, true), split('Taylor', 2000)])];

  assert.deepEqual(computeBalances(list, 'alex').people, [{ username: 'Taylor', cents: 2000 }]);
  assert.deepEqual(computeBalances(list, 'SAM'), { net: 0, people: [] });
  assert.deepEqual(computeBalances([], 'Alex'), { net: 0, people: [] });
  // The payer never owes themselves, even if their own share is stored as unpaid.
  const untidy = [expense('Alex', 4000, [split('Alex', 2000, false), split('Sam', 2000)])];
  assert.deepEqual(computeBalances(untidy, 'Alex'), { net: 2000, people: [{ username: 'Sam', cents: 2000 }] });
  assert.deepEqual(computeBalances(untidy, 'Sam'), { net: -2000, people: [{ username: 'Alex', cents: -2000 }] });
  // People who cancel out disappear.
  const even = [
    expense('Alex', 2000, [split('Alex', 1000, true), split('Sam', 1000)]),
    expense('Sam', 2000, [split('Sam', 1000, true), split('Alex', 1000)]),
  ];
  assert.deepEqual(computeBalances(even, 'Alex'), { net: 0, people: [] });
});

test('expenses balanceLines says who owes whom in plain words', () => {
  assert.deepEqual(balanceLines(computeBalances(house(), 'Alex')), ['Taylor owes you $20.00', 'Sam owes you $10.00']);
  assert.deepEqual(balanceLines(computeBalances(house(), 'Taylor')), ['You owe Alex $20.00', 'You owe Sam $10.00']);
  assert.deepEqual(balanceLines({ net: 0, people: [] }), []);
});

test('expenses describeShare shows how one expense affects you', () => {
  const bill = expense('Alex', 6000, [split('Alex', 2000, true), split('Sam', 2000), split('Taylor', 2000, true)]);

  assert.deepEqual(describeShare(bill, 'Alex'), { kind: 'lent', cents: 2000, label: 'you lent' }); // only Sam still owes
  assert.deepEqual(describeShare(bill, 'Sam'), { kind: 'owe', cents: 2000, label: 'you owe' });
  assert.deepEqual(describeShare(bill, 'Taylor'), { kind: 'settled', cents: 2000, label: 'settled up' });
  assert.deepEqual(describeShare(bill, 'Casey'), { kind: 'none', cents: 0, label: 'not involved' });
  const alone = expense('Alex', 500, [split('Alex', 500, true)]);
  assert.deepEqual(describeShare(alone, 'Alex'), { kind: 'none', cents: 0, label: 'just you' });
  const allPaid = expense('Alex', 4000, [split('Alex', 2000, true), split('Sam', 2000, true)]);
  assert.deepEqual(describeShare(allPaid, 'Alex'), { kind: 'settled', cents: 2000, label: 'settled up' });
});

test('expenses expenseSubtitle names the payer and how many people share it', () => {
  const bill = expense('Sam', 6000, [split('Sam', 2000, true), split('Alex', 2000), split('Taylor', 2000)]);

  assert.equal(expenseSubtitle(bill, 'Alex'), 'Sam paid $60.00 · 3 people');
  assert.equal(expenseSubtitle(bill, 'sam'), 'You paid $60.00 · 3 people');
  assert.equal(expenseSubtitle(expense('Sam', 500, [split('Sam', 500, true)]), 'Sam'), 'You paid $5.00 · 1 person');
  assert.equal(expenseSubtitle(expense('Sam', 500, []), 'Alex'), 'Sam paid $5.00 · 1 person');
});

// ---- grouping and ordering --------------------------------------------------------------------------

test('expenses groupByDay groups newest first under Today, Yesterday and dates, and leaves its input alone', () => {
  const now = new Date(2026, 10, 19, 15, 0); // Nov 19, 2026, 3pm local time
  const at = (y, m, d, h = 12) => new Date(y, m, d, h).toISOString();
  const list = Object.freeze([
    expense('A', 1, [], at(2026, 10, 12)),
    expense('A', 2, [], at(2026, 10, 19, 9)),
    expense('A', 3, [], 'not a date'),
    expense('A', 4, [], at(2025, 10, 3)),
    expense('A', 5, [], at(2026, 10, 18, 23)),
    expense('A', 6, [], at(2026, 10, 19, 14)),
  ].map(Object.freeze));

  const groups = groupByDay(list, now);

  assert.deepEqual(groups.map((g) => g.label), ['Today', 'Yesterday', 'Nov 12', 'Nov 3, 2025', 'Earlier']);
  assert.deepEqual(groups[0].expenses.map((e) => e.amountCents), [6, 2]); // newest first inside a day
  assert.deepEqual(groups.flatMap((g) => g.expenses).length, 6);
  assert.deepEqual(groupByDay([], now), []);
});

test('expenses addExpense puts a new expense first, and adding the same one twice changes nothing', () => {
  const older = expense('A', 1, [], '2026-11-10T10:00:00.000Z');
  const newer = expense('A', 2, [], '2026-11-12T10:00:00.000Z');
  const list = Object.freeze([older]);

  const added = addExpense(list, newer);

  assert.deepEqual(added.map((e) => e.id), [newer.id, older.id]);
  assert.equal(addExpense(added, newer), added);
  assert.deepEqual(list.map((e) => e.id), [older.id]);
});

// ---- the fake-data API (same rules as the real server) ----------------------------------------------

async function household() {
  const run = `${Date.now().toString(36)}${counter++}`;
  const alex = await api.signUp(`alex-${run}`, 'password-alex');
  const sam = await api.signUp(`sam-${run}`, 'password-sam1');
  const outsider = await api.signUp(`otto-${run}`, 'password-otto');
  const inviteCode = await api.createConversation(alex.token);
  await api.joinConversation(sam.token, inviteCode);
  const members = await api.getMembers(alex.token, inviteCode);
  const idOf = (username) => members.find((m) => m.username === username).id;
  return { alex, sam, outsider, inviteCode, idOf };
}

test('expenses the member list carries each person\'s id, which splitting needs', async () => {
  const { alex, sam, inviteCode, idOf } = await household();

  assert.equal(idOf(alex.user.username), alex.user.id);
  assert.equal(idOf(sam.user.username), sam.user.id);
});

test('expenses creating an expense records the signed-in user as payer, with their own share already paid', async () => {
  const { alex, sam, inviteCode, idOf } = await household();
  const shares = splitEqually(6000, [alex.user.id, sam.user.id], alex.user.id);

  const saved = await api.createExpense(alex.token, inviteCode, {
    title: '  Groceries  ',
    amountCents: 6000,
    splits: shares.map((s) => ({ ...s, username: s.userId === alex.user.id ? alex.user.username : sam.user.username })),
  });

  assert.equal(saved.title, 'Groceries');
  assert.equal(saved.amountCents, 6000);
  assert.equal(saved.paidByUsername, alex.user.username);
  assert.ok(!Number.isNaN(Date.parse(saved.createdAt)));
  assert.deepEqual(saved.splits.map((s) => [s.username, s.amountCents, s.isPaid]), [
    [alex.user.username, 3000, true], [sam.user.username, 3000, false],
  ]);
  // The roommate sees the same expense, and it shows what they owe.
  const [seen] = await api.getExpenses(sam.token, inviteCode);
  assert.equal(seen.id, saved.id);
  assert.deepEqual(computeBalances([seen], sam.user.username).people, [{ username: alex.user.username, cents: -3000 }]);
});

test('expenses getExpenses lists the newest first, and the list is a copy that can\'t change the stored data', async () => {
  const { alex, inviteCode } = await household();
  const mine = [{ userId: alex.user.id, username: alex.user.username, amountCents: 500 }];
  const first = await api.createExpense(alex.token, inviteCode, { title: 'First', amountCents: 500, splits: mine });
  const second = await api.createExpense(alex.token, inviteCode, { title: 'Second', amountCents: 500, splits: mine });

  const list = await api.getExpenses(alex.token, inviteCode);
  list[0].title = 'tampered';
  list[0].splits[0].amountCents = 1;

  assert.deepEqual((await api.getExpenses(alex.token, inviteCode)).map((e) => e.title), ['Second', 'First']);
  assert.equal((await api.getExpenses(alex.token, inviteCode))[0].splits[0].amountCents, 500);
  assert.notEqual(first.id, second.id);
});

test('expenses an expense needs a title of 1 to 100 characters and a whole, positive amount', async () => {
  const { alex, inviteCode } = await household();
  const mine = (amount) => [{ userId: alex.user.id, username: alex.user.username, amountCents: amount }];
  const refused = (title, amountCents) =>
    assert.rejects(api.createExpense(alex.token, inviteCode, { title, amountCents, splits: mine(100) }), (error) => {
      assert.equal(error.name, 'MessagingError');
      assert.equal(error.code, 'INVALID_INPUT');
      assert.equal(error.message, 'Title and a positive amount are required.');
      return true;
    });

  await refused('   ', 1000);
  await refused('x'.repeat(101), 1000);
  await refused('Rent', 0);
  await refused('Rent', -500);
  await refused('Rent', 10.5);
  assert.deepEqual(await api.getExpenses(alex.token, inviteCode), []);
  await api.createExpense(alex.token, inviteCode, { title: 'x'.repeat(100), amountCents: 100, splits: mine(100) });
  assert.equal((await api.getExpenses(alex.token, inviteCode)).length, 1);
});

test('expenses a share for someone outside the household is refused and nothing is saved', async () => {
  const { alex, outsider, inviteCode } = await household();

  await assert.rejects(
    api.createExpense(alex.token, inviteCode, {
      title: 'Pizza', amountCents: 1000,
      splits: [{ userId: outsider.user.id, username: outsider.user.username, amountCents: 1000 }],
    }),
    (error) => error.code === 'INVALID_INPUT' && error.message === 'Invalid split user IDs or amounts.',
  );
  assert.deepEqual(await api.getExpenses(alex.token, inviteCode), []);
});

test('expenses people outside the household can neither read nor add expenses, and a bad session is refused', async () => {
  const { outsider, alex, inviteCode } = await household();
  const mine = [{ userId: alex.user.id, username: alex.user.username, amountCents: 500 }];

  await assert.rejects(api.getExpenses(outsider.token, inviteCode), (e) => e.code === 'NOT_A_MEMBER');
  await assert.rejects(api.createExpense(outsider.token, inviteCode, { title: 'x', amountCents: 500, splits: mine }), (e) => e.code === 'NOT_A_MEMBER');
  await assert.rejects(api.getExpenses('bogus-token', inviteCode), (e) => e.code === 'UNAUTHENTICATED');
  await assert.rejects(api.getExpenses(alex.token, 'ZZZZZZ'), (e) => e.code === 'CONVERSATION_NOT_FOUND');
});
