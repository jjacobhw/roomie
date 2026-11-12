import { Alert, Platform } from 'react-native';

// Ask "are you sure?" before something that can't be undone. Resolves true only if the user agrees.
// Alert.alert shows a native dialog on iOS and Android, but does nothing on the web, so the web
// build uses the browser's own confirm box instead.
export function confirmAction(title: string, message: string, confirmLabel: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    const ask = (globalThis as { confirm?: (text: string) => boolean }).confirm;
    return Promise.resolve(typeof ask === 'function' ? ask(`${title}\n\n${message}`) : false);
  }
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
      ],
      // Tapping outside the dialog (Android) counts as "no".
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
