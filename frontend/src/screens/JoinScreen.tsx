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
import { USING_MOCK } from "../config";
import { createConversation, joinConversation } from "../services/messagingApi";
import { MessagingError } from "../types/messaging";
import { INVITE_CODE_LENGTH, normalizeInviteCode } from "../utils/inviteCode";

type Props = {
  username: string;
  token: string;
  // Called once the user has joined (or created and continued to) a household.
  onEnter: (inviteCode: string) => void;
  onLogout: () => void;
  // The server says the session is no longer valid.
  onSessionExpired: () => void;
};

export function JoinScreen({ username, token, onEnter, onLogout, onSessionExpired }: Props) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Right after creating a household we show its invite code once, so it can be shared.
  const [createdCode, setCreatedCode] = useState<string | null>(null);

  const canJoin = code.length === INVITE_CODE_LENGTH && !busy;

  // Runs a create/join request, showing a spinner while it works and any error afterwards.
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      if (e instanceof MessagingError && e.code === "UNAUTHENTICATED") {
        onSessionExpired();
        return;
      }
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
    setBusy(false);
  }

  const handleCreate = () =>
    run(async () => {
      setCreatedCode(await createConversation(token));
    });
  const handleJoin = () =>
    run(async () => {
      await joinConversation(token, code);
      onEnter(code);
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
          <View style={styles.signedInBar}>
            <Text style={styles.signedInText}>
              Signed in as <Text style={styles.signedInName}>{username}</Text>
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={onLogout}
              style={styles.logoutLink}
            >
              <Text style={styles.logoutLinkText}>Log out</Text>
            </Pressable>
          </View>

          <View style={styles.logo}>
            <Text style={styles.logoText}>R</Text>
          </View>
          <Text style={styles.title}>Roomie</Text>
          <Text style={styles.subtitle}>Everyone in sync</Text>

          {createdCode ? (
            <>
              <View style={styles.codeCard}>
                <Text style={styles.codeCardTitle}>Household created</Text>
                <Text style={styles.codeCardNote}>
                  Share this code with your roommates so they can join.
                </Text>
                <Text selectable style={styles.codeCardValue}>
                  {createdCode}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => onEnter(createdCode)}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>Go to chat</Text>
              </Pressable>
            </>
          ) : (
            <>
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
            </>
          )}

          <View style={styles.statusArea}>
            {busy && <ActivityIndicator color={colors.primary} />}
            {error && <Text style={styles.error}>{error}</Text>}
          </View>

          {USING_MOCK && !createdCode && (
            <Text style={styles.hint}>
              Try the code DEMO12 to join a fake-mock household
            </Text>
          )}
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
  signedInBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 28,
  },
  signedInText: {
    color: colors.textMuted,
    fontSize: 13,
  },
  signedInName: {
    color: colors.text,
    fontWeight: "700",
  },
  logoutLink: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: colors.primarySoft,
  },
  logoutLinkText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "700",
  },
  codeCard: {
    alignItems: "center",
    padding: 24,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginBottom: 20,
  },
  codeCardTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
  },
  codeCardNote: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: "center",
    marginTop: 6,
  },
  codeCardValue: {
    color: colors.primary,
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: 6,
    marginTop: 16,
  },
});
