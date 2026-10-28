import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { colors } from './src/constants/colors';
import { AuthScreen } from './src/screens/AuthScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { JoinScreen } from './src/screens/JoinScreen';
import { getMyConversation, signOut } from './src/services/messagingApi';
import { Session } from './src/types/messaging';

// Which screen shows depends on two things (so no navigation library is needed yet):
//   session      null -> sign in / sign up
//   inviteCode   null -> create or join a household, otherwise -> the household's chat
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  // True while we ask the server whether the user already belongs to a household.
  const [checking, setChecking] = useState(false);
  // Lets a slow answer be ignored if the user has already signed out (or in as someone else).
  const attempt = useRef(0);

  const handleAuthenticated = useCallback((newSession: Session) => {
    const thisAttempt = ++attempt.current;
    setSession(newSession);
    setInviteCode(null);
    setChecking(true);
    getMyConversation(newSession.token)
      .then((household) => {
        if (attempt.current === thisAttempt) setInviteCode(household?.inviteCode ?? null);
      })
      .catch(() => {
        // Couldn't tell; fall back to the create/join screen, which reports any real problem.
      })
      .finally(() => {
        if (attempt.current === thisAttempt) setChecking(false);
      });
  }, []);

  const reset = useCallback(() => {
    attempt.current++;
    setSession(null);
    setInviteCode(null);
    setChecking(false);
  }, []);

  // Log out: tell the server to forget the token (best effort), then go back to sign in.
  const handleLogout = useCallback(() => {
    if (session) signOut(session.token).catch(() => {});
    reset();
  }, [session, reset]);

  if (!session) {
    return <AuthScreen onAuthenticated={handleAuthenticated} />;
  }

  if (checking) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!inviteCode) {
    return (
      <JoinScreen
        username={session.user.username}
        token={session.token}
        onEnter={setInviteCode}
        onLogout={handleLogout}
        onSessionExpired={reset}
      />
    );
  }

  return (
    <ChatScreen
      username={session.user.username}
      token={session.token}
      inviteCode={inviteCode}
      onLogout={handleLogout}
      onSessionExpired={reset}
    />
  );
}
