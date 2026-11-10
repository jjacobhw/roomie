import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from './src/constants/colors';
import { AuthScreen } from './src/screens/AuthScreen';
import { HouseholdInfoScreen } from './src/screens/HouseholdInfoScreen';
import { JoinScreen } from './src/screens/JoinScreen';
import { MainTabs } from './src/screens/MainTabs';
import { getMyConversation, signOut } from './src/services/messagingApi';
import { Session } from './src/types/messaging';

// Which screen shows depends on two things (so no navigation library is needed yet):
//   session      null -> sign in / sign up
//   inviteCode   null -> create or join a household, otherwise -> the household's chat
//   showInfo     true -> the household screen (members, rename, leave, log out) over the chat
function AppContent() {
  const [session, setSession] = useState<Session | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [householdName, setHouseholdName] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  // True while we ask the server whether the user already belongs to a household.
  const [checking, setChecking] = useState(false);
  // Lets a slow answer be ignored if the user has already signed out (or in as someone else).
  const attempt = useRef(0);

  const handleAuthenticated = useCallback((newSession: Session) => {
    const thisAttempt = ++attempt.current;
    setSession(newSession);
    setInviteCode(null);
    setHouseholdName(null);
    setShowInfo(false);
    setChecking(true);
    getMyConversation(newSession.token)
      .then((household) => {
        if (attempt.current === thisAttempt) {
          setInviteCode(household?.inviteCode ?? null);
          setHouseholdName(household?.name || null);
        }
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
    setHouseholdName(null);
    setShowInfo(false);
    setChecking(false);
  }, []);

  // After create / join, show the chat at once and fill in the household's name when it arrives.
  const handleEnter = useCallback(
    (code: string) => {
      const thisAttempt = attempt.current;
      setInviteCode(code);
      setHouseholdName(null);
      if (!session) return;
      getMyConversation(session.token)
        .then((household) => {
          if (attempt.current === thisAttempt && household?.inviteCode === code) {
            setHouseholdName(household.name || null);
          }
        })
        .catch(() => {});
    },
    [session],
  );

  const handleLeft = useCallback(() => {
    setInviteCode(null);
    setHouseholdName(null);
    setShowInfo(false);
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
        onEnter={handleEnter}
        onLogout={handleLogout}
        onSessionExpired={reset}
      />
    );
  }

  if (showInfo) {
    return (
      <HouseholdInfoScreen
        username={session.user.username}
        token={session.token}
        inviteCode={inviteCode}
        householdName={householdName}
        onBack={() => setShowInfo(false)}
        onRenamed={setHouseholdName}
        onLeft={handleLeft}
        onLogout={handleLogout}
        onSessionExpired={reset}
      />
    );
  }

  return (
    <MainTabs
      username={session.user.username}
      token={session.token}
      inviteCode={inviteCode}
      householdName={householdName}
      onOpenInfo={() => setShowInfo(true)}
      onSessionExpired={reset}
    />
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}
