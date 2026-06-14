import {
  Action,
  ActionPanel,
  Detail,
  Form,
  Icon,
  openExtensionPreferences,
  Toast,
  showToast,
} from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { ReactNode, useCallback, useEffect, useState } from "react";
import {
  InvalidCredentialsError,
  InvalidMfaCodeError,
  signIn,
  submitMfa,
} from "./auth";

type Phase = "loading" | "mfa" | "ready" | "error";

/**
 * Wraps a command so its content only renders once iCloud sign-in succeeds.
 * Handles the loading spinner, the 2FA code prompt, and credential errors.
 */
export function AuthGate({ children }: { children: () => ReactNode }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<Error | undefined>();

  const start = useCallback(async () => {
    setPhase("loading");
    setError(undefined);
    try {
      const result = await signIn();
      setPhase(result === "mfa" ? "mfa" : "ready");
    } catch (err) {
      setError(err as Error);
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    start();
  }, [start]);

  const onSubmitCode = useCallback(async (code: string) => {
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Verifying code",
    });
    try {
      await submitMfa(code);
      toast.style = Toast.Style.Success;
      toast.title = "Signed in";
      setPhase("ready");
    } catch (err) {
      if (err instanceof InvalidMfaCodeError) {
        toast.style = Toast.Style.Failure;
        toast.title = err.message;
        // stay on the MFA form to let them retry
      } else {
        await showFailureToast(err, { title: "Sign-in failed" });
        setError(err as Error);
        setPhase("error");
      }
    }
  }, []);

  if (phase === "ready") return <>{children()}</>;
  if (phase === "mfa") return <MfaForm onSubmit={onSubmitCode} />;
  if (phase === "error") return <AuthError error={error} onRetry={start} />;
  return <Detail isLoading markdown="Signing in to iCloud…" />;
}

function MfaForm({ onSubmit }: { onSubmit: (code: string) => void }) {
  return (
    <Form
      navigationTitle="Two-Factor Authentication"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Verify"
            icon={Icon.Check}
            onSubmit={(values: { code: string }) =>
              onSubmit((values.code ?? "").replace(/\D/g, ""))
            }
          />
        </ActionPanel>
      }
    >
      <Form.Description text="Apple sent a 6-digit verification code to your trusted devices. Enter it below — this only happens about once a month." />
      <Form.TextField
        id="code"
        title="Verification Code"
        placeholder="123456"
        autoFocus
      />
    </Form>
  );
}

function AuthError({ error, onRetry }: { error?: Error; onRetry: () => void }) {
  const isCreds = error instanceof InvalidCredentialsError;
  const md = `# Could not sign in to iCloud\n\n${error?.message ?? "Unknown error."}${
    isCreds
      ? "\n\nCheck your Apple ID and password in the extension preferences."
      : ""
  }`;
  return (
    <Detail
      markdown={md}
      actions={
        <ActionPanel>
          <Action
            title="Open Extension Preferences"
            icon={Icon.Gear}
            onAction={openExtensionPreferences}
          />
          <Action
            title="Try Again"
            icon={Icon.ArrowClockwise}
            onAction={onRetry}
          />
        </ActionPanel>
      }
    />
  );
}
