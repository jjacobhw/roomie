import { useState } from 'react';
import { ChatScreen } from './src/screens/ChatScreen';
import { JoinScreen } from './src/screens/JoinScreen';

// Who is signed in and which chat they're in. null means "show the join screen".
// (Two screens don't need a navigation library yet; this one variable is enough.)
type Session = { username: string; inviteCode: string };

export default function App() {
  const [session, setSession] = useState<Session | null>(null);

  if (!session) {
    return (
      <JoinScreen onEnter={(username, inviteCode) => setSession({ username, inviteCode })} />
    );
  }

  return (
    <ChatScreen
      username={session.username}
      inviteCode={session.inviteCode}
      onLogout={() => setSession(null)}
    />
  );
}
