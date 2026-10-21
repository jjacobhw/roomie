import { ChatScreen } from './src/screens/ChatScreen';

// Sprint 1: A join/create screen comes later.
const DEMO_INVITE_CODE = 'DEMO12';

export default function App() {
  return <ChatScreen inviteCode={DEMO_INVITE_CODE} />;
}
