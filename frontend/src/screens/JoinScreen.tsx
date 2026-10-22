import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { colors } from "../constants/colors";
import { createConversation, joinConversation } from "../services/messagingApi";
import { USERS, Username } from "../types/messaging";
import { INVITE_CODE_LENGTH, normalizeInviteCode } from "../utils/inviteCode";

type Props = {
  // Called once the user has created or joined a chat and should see it.
  onEnter: (username: Username, inviteCode: string) => void;
};

export function JoinScreen({ onEnter }: Props) {
  // Sprint 1: usernames are hardcoded, so you pick who you are instead of logging in.
  const [username, setUsername] = useState<Username>(USERS[0]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canJoin = code.length === INVITE_CODE_LENGTH && !busy;

  // Runs a create/join request, showing a spinner while it works and any error afterwards.
  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError(null);
    try {
      onEnter(username, await action());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  }

  const handleCreate = () => run(() => createConversation(username));
  const handleJoin = () =>
    run(async () => {
      await joinConversation(username, code);
      return code;
    });

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.logo}>
            <Text style={styles.logoText}>R</Text>
          </View>
          <Text style={styles.title}>Roomie</Text>
          <Text style={styles.subtitle}>Everyone in sync</Text>

          <Text style={styles.label}>I AM</Text>
          <View style={styles.userPicker}>
            {USERS.map((name) => {
              const selected = name === username;
              return (
                <Pressable
                  key={name}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    setUsername(name);
                    setError(null);
                  }}
                  style={[
                    styles.userOption,
                    selected && styles.selectedUserOption,
                  ]}
                >
                  <Text
                    style={[
                      styles.userOptionText,
                      selected && styles.selectedUserOptionText,
                    ]}
                  >
                    {name}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={handleCreate}
            style={[styles.primaryButton, busy && styles.disabledButton]}
          >
            <Text style={styles.primaryButtonText}>Create a Household</Text>
          </Pressable>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR JOIN WITH A CODE</Text>
            <View style={styles.dividerLine} />
          </View>

          <TextInput
            accessibilityLabel="Invite code"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={INVITE_CODE_LENGTH}
            onChangeText={(text) => {
              setCode(normalizeInviteCode(text));
              setError(null);
            }}
            onSubmitEditing={handleJoin}
            placeholder="ABC123"
            placeholderTextColor={colors.textFaint}
            returnKeyType="go"
            style={styles.codeInput}
            value={code}
          />
          <Pressable
            accessibilityRole="button"
            disabled={!canJoin}
            onPress={handleJoin}
            style={[
              styles.secondaryButton,
              !canJoin && styles.disabledSecondary,
            ]}
          >
            <Text
              style={[
                styles.secondaryButtonText,
                !canJoin && styles.disabledSecondaryText,
              ]}
            >
              Join a Household
            </Text>
          </Pressable>

          <View style={styles.statusArea}>
            {busy && <ActivityIndicator color={colors.primary} />}
            {error && <Text style={styles.error}>{error}</Text>}
          </View>

          <Text style={styles.hint}>
            Try the code DEMO12 to join a fake-mock household
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 28,
    paddingVertical: 32,
  },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    backgroundColor: colors.primary,
  },
  logoText: {
    color: colors.onPrimary,
    fontSize: 32,
    fontWeight: "800",
  },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 14,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: "center",
    marginTop: 4,
    marginBottom: 32,
  },
  label: {
    color: colors.textFaint,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  userPicker: {
    flexDirection: "row",
    marginBottom: 24,
  },
  userOption: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 18,
    backgroundColor: colors.surfaceMuted,
    marginRight: 8,
  },
  selectedUserOption: {
    backgroundColor: colors.primarySoft,
  },
  userOptionText: {
    color: colors.textMuted,
    fontSize: 14,
  },
  selectedUserOptionText: {
    color: colors.primary,
    fontWeight: "700",
  },
  primaryButton: {
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  disabledButton: {
    backgroundColor: colors.primaryDisabled,
  },
  primaryButtonText: {
    color: colors.onPrimary,
    fontSize: 16,
    fontWeight: "700",
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 26,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    color: colors.textFaint,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    marginHorizontal: 12,
  },
  codeInput: {
    height: 52,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: 4,
    textAlign: "center",
  },
  secondaryButton: {
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  disabledSecondary: {
    borderColor: colors.border,
  },
  secondaryButtonText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: "700",
  },
  disabledSecondaryText: {
    color: colors.textFaint,
  },
  statusArea: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
  },
  error: {
    color: colors.error,
    fontSize: 13,
    textAlign: "center",
  },
  hint: {
    color: colors.textFaint,
    fontSize: 11,
    textAlign: "center",
  },
});
