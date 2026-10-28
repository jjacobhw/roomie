import { useRef, useState } from "react";
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
import { signIn, signUp } from "../services/messagingApi";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  Session,
  USERNAME_MAX_LENGTH,
} from "../types/messaging";
import { validateCredentials } from "../utils/credentials";

type Props = {
  onAuthenticated: (session: Session) => void;
};

type Mode = "signin" | "signup";

export function AuthScreen({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<Mode>("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);

  const isSignUp = mode === "signup";

  async function submit() {
    if (busy) return;
    // Signing in only needs the fields filled; the length rules matter when choosing a password.
    const problem = isSignUp
      ? validateCredentials(username, password)
      : username.trim() === "" || password === ""
        ? "Enter your username and password."
        : null;
    if (problem) {
      setError(problem);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const session = isSignUp
        ? await signUp(username.trim(), password)
        : await signIn(username.trim(), password);
      onAuthenticated(session);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  }

  function switchMode() {
    setMode(isSignUp ? "signin" : "signup");
    setError(null);
  }

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
          <Text style={styles.subtitle}>
            {isSignUp ? "Create your account" : "Welcome back"}
          </Text>

          <TextInput
            accessibilityLabel="Username"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            maxLength={USERNAME_MAX_LENGTH}
            onChangeText={(text) => {
              setUsername(text);
              setError(null);
            }}
            onSubmitEditing={() => passwordRef.current?.focus()}
            placeholder="Username"
            placeholderTextColor={colors.textFaint}
            returnKeyType="next"
            style={styles.input}
            textContentType="username"
            value={username}
          />
          <TextInput
            ref={passwordRef}
            accessibilityLabel="Password"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            maxLength={PASSWORD_MAX_LENGTH}
            onChangeText={(text) => {
              setPassword(text);
              setError(null);
            }}
            onSubmitEditing={submit}
            placeholder={isSignUp ? `Password (${PASSWORD_MIN_LENGTH}+ characters)` : "Password"}
            placeholderTextColor={colors.textFaint}
            returnKeyType="go"
            secureTextEntry
            style={[styles.input, styles.inputSpaced]}
            textContentType={isSignUp ? "newPassword" : "password"}
            value={password}
          />

          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={submit}
            style={[styles.primaryButton, busy && styles.disabledButton]}
          >
            <Text style={styles.primaryButtonText}>
              {isSignUp ? "Sign up" : "Sign in"}
            </Text>
          </Pressable>

          <View style={styles.statusArea}>
            {busy && <ActivityIndicator color={colors.primary} />}
            {error && <Text style={styles.error}>{error}</Text>}
          </View>

          <Pressable accessibilityRole="button" disabled={busy} onPress={switchMode} style={styles.switchMode}>
            <Text style={styles.switchModeText}>
              {isSignUp ? "Already have an account? Sign in" : "New here? Create an account"}
            </Text>
          </Pressable>

          {USING_MOCK && (
            <Text style={styles.hint}>
              Fake-data mode: sign up with any username and an 8+ character password.
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
  input: {
    height: 52,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 16,
  },
  inputSpaced: {
    marginTop: 12,
    marginBottom: 20,
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
  switchMode: {
    alignSelf: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  switchModeText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "700",
  },
  hint: {
    color: colors.textFaint,
    fontSize: 11,
    textAlign: "center",
    marginTop: 8,
  },
});
