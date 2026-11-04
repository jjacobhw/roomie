import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChatIcon, CheckSquareIcon } from '../components/icons';
import { TabBar, type Tab } from '../components/TabBar';
import { colors } from '../constants/colors';
import { useKeyboardVisible } from '../hooks/useKeyboardVisible';
import { ChatScreen } from './ChatScreen';
import { ChoresScreen } from './ChoresScreen';

type TabKey = 'chat' | 'chores';

const TABS: Tab<TabKey>[] = [
  { key: 'chat', label: 'Chat', icon: (props) => <ChatIcon {...props} /> },
  { key: 'chores', label: 'Chores', icon: (props) => <CheckSquareIcon {...props} /> },
];

type Props = {
  username: string;
  token: string;
  inviteCode: string;
  onLogout: () => void;
  onSessionExpired: () => void;
};

// The signed-in app: the Chat and Chores screens with a tab bar at the bottom.
export function MainTabs({ username, token, inviteCode, onLogout, onSessionExpired }: Props) {
  const [tab, setTab] = useState<TabKey>('chat');
  const keyboardVisible = useKeyboardVisible();
  // The phone's status bar (top) and home indicator (bottom). The top padding keeps the screens
  // clear of the status bar; the bottom one is handed to the tab bar so its white fills to the edge.
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Both screens stay mounted and the inactive one is hidden, so the chat keeps its
          messages, draft and polling while you look at the chores. */}
      <View style={[styles.screen, tab !== 'chat' && styles.hidden]}>
        <ChatScreen
          username={username}
          token={token}
          inviteCode={inviteCode}
          onLogout={onLogout}
          onSessionExpired={onSessionExpired}
        />
      </View>
      <View style={[styles.screen, tab !== 'chores' && styles.hidden]}>
        <ChoresScreen username={username} />
      </View>
      {/* Hidden while typing, so it doesn't sit between the keyboard and the text box. */}
      {!keyboardVisible && (
        <TabBar tabs={TABS} active={tab} onChange={setTab} bottomInset={insets.bottom} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  screen: {
    flex: 1,
  },
  hidden: {
    display: 'none',
  },
});
