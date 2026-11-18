// Phone notifications for chores and expenses.
// After sign in we ask permission, get this phone's Expo push token, and send it to the backend,
// which uses it to notify the user (backend/notifications.ts). Nothing happens on web,
// in the simulator, in Expo Go on Android (no push support there), or with the mock backend.
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { USING_MOCK } from '../config';
import { registerPushToken, unregisterPushToken } from './httpApi';

// Show notifications even while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// The token we registered, so log out can remove the same one.
let registeredToken: string | null = null;

function pushSupported(): boolean {
  if (USING_MOCK || Platform.OS === 'web' || !Device.isDevice) return false;
  const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
  return !(inExpoGo && Platform.OS === 'android');
}

// The EAS project id from app.json (expo.extra.eas.projectId), set by `eas init`.
function projectId(): string | undefined {
  return Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

// Ask for permission and register this phone. Returns false if notifications are off or unsupported.
// Never throws: notifications are a nice-to-have and shouldn't block the app.
export async function enablePushNotifications(sessionToken: string): Promise<boolean> {
  if (!pushSupported()) return false;
  try {
    if (Platform.OS === 'android') {
      // Android 8+ needs a channel; the backend sends with channelId "default".
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Chores and expenses',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== 'granted') return false;

    const id = projectId();
    if (!id) {
      console.warn('Push notifications need an EAS projectId in app.json (run `eas init`).');
      return false;
    }
    const { data: pushToken } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    await registerPushToken(sessionToken, pushToken, Platform.OS === 'ios' ? 'ios' : 'android');
    registeredToken = pushToken;
    return true;
  } catch (error) {
    console.warn('Could not enable push notifications:', error);
    return false;
  }
}

// Call before signing out (while the session token still works).
export async function disablePushNotifications(sessionToken: string): Promise<void> {
  const pushToken = registeredToken;
  registeredToken = null;
  if (!pushToken) return;
  try {
    await unregisterPushToken(sessionToken, pushToken);
  } catch {
    // Best effort: the server also drops tokens Expo reports as dead.
  }
}
