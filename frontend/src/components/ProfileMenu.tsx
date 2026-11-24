import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { changeUsername } from '../services/messagingApi.ts';
import { USERNAME_MAX_LENGTH, MessagingError } from '../types/messaging.ts';
import type { AuthUser } from '../types/messaging.ts';
import { colors } from '../constants/colors.ts';

type Props = {
  username: string;
  token: string;
  onUsernameChanged?: (user: AuthUser) => void;
  onSessionExpired: () => void;
  menuAlign?: 'left' | 'right';
};

export function ProfileMenu({
  username,
  token,
  onUsernameChanged,
  onSessionExpired,
  menuAlign = 'left',
}: Props) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(username);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) setEditing(false);
  }, [open]);

  function close() {
    setOpen(false);
    setEditing(false);
    setError(null);
  }

  function startEditing() {
    setDraft(username);
    setError(null);
    setEditing(true);
  }

  async function save() {
    if (saving) return;
    const trimmed = draft.trim();
    if (trimmed.length < 1) {
      setError('Username can’t be empty');
      return;
    }
    if (trimmed.length > USERNAME_MAX_LENGTH) {
      setError(`Username must be at most ${USERNAME_MAX_LENGTH} characters`);
      return;
    }
    if (trimmed.toLowerCase() === username.toLowerCase()) {
      close();
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const saved = await changeUsername(token, trimmed);
      onUsernameChanged?.(saved);
      close();
    } catch (e) {
      if (e instanceof MessagingError && e.code === 'UNAUTHENTICATED') {
        close();
        onSessionExpired();
      } else {
        setError(e instanceof Error ? e.message : 'Something went wrong');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Profile menu"
        accessibilityState={{ expanded: open }}
        onPress={() => open ? close() : setOpen(true)}
        style={styles.profileControl}
      >
        <View style={styles.profilePicture}>
          <View style={styles.avatarHead} />
          <View style={styles.avatarBody} />
        </View>
        <Text style={styles.profileLabel}>You</Text>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={close}
      >
        <Pressable accessibilityRole="button" accessibilityLabel="Close profile menu" onPress={close} style={styles.backdrop}>
          <View
            onStartShouldSetResponder={() => true}
            style={[styles.menu, menuAlign === 'left' ? styles.menuLeft : styles.menuRight]}
          >
            {editing ? (
              <View style={styles.form}>
                <Text style={styles.formTitle}>Change username</Text>
                <TextInput
                  accessibilityLabel="New username"
                  value={draft}
                  onChangeText={setDraft}
                  autoFocus
                  maxLength={USERNAME_MAX_LENGTH}
                  editable={!saving}
                  returnKeyType="done"
                  onSubmitEditing={save}
                  placeholder="Username"
                  placeholderTextColor={colors.textFaint}
                  style={styles.input}
                />
                {error && <Text style={styles.error}>{error}</Text>}
                <View style={styles.actions}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={saving}
                    onPress={close}
                    style={[styles.actionButton, styles.cancelButton]}
                  >
                    <Text style={styles.cancelText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={saving}
                    onPress={save}
                    style={[styles.actionButton, styles.saveButton]}
                  >
                    {saving ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.saveText}>Save</Text>}
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Change username"
                onPress={startEditing}
                style={styles.menuItem}
              >
                <Text style={styles.menuItemText}>Change username</Text>
              </Pressable>
            )}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  profileControl: {
    width: 52,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profilePicture: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    overflow: 'hidden',
  },
  avatarHead: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.textMuted,
    marginTop: 8,
  },
  avatarBody: {
    width: 24,
    height: 14,
    borderRadius: 12,
    backgroundColor: colors.textMuted,
    marginTop: 3,
  },
  profileLabel: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  backdrop: {
    flex: 1,
  },
  menu: {
    position: 'absolute',
    top: 70,
    minWidth: 210,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  menuLeft: {
    left: 18,
  },
  menuRight: {
    right: 18,
  },
  menuItem: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  menuItemText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  form: {
    width: 260,
    padding: 14,
  },
  formTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 10,
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    color: colors.text,
  },
  error: {
    color: colors.error,
    fontSize: 12,
    marginTop: 7,
  },
  actions: {
    flexDirection: 'row',
    marginTop: 10,
  },
  actionButton: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 8,
  },
  cancelText: {
    color: colors.text,
    fontWeight: '700',
  },
  saveButton: {
    backgroundColor: colors.primary,
  },
  saveText: {
    color: colors.onPrimary,
    fontWeight: '800',
  },
});
