import {
  Action,
  ActionPanel,
  Clipboard,
  Form,
  Icon,
  Toast,
  openExtensionPreferences,
  popToRoot,
  showToast,
  useNavigation,
} from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { useEffect, useState } from "react";
import { generateHme, NotAuthenticatedError, reserveHme } from "./icloud";

interface CreateHmeProps {
  /** Called after a successful reservation, e.g. to refresh the search list. */
  onCreated?: () => void;
}

export default function CreateHme({ onCreated }: CreateHmeProps) {
  const navigation = useNavigation();
  const [hme, setHme] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  async function generate() {
    setIsLoading(true);
    setError(undefined);
    try {
      setHme(await generateHme());
    } catch (err) {
      if (err instanceof NotAuthenticatedError) {
        setError(err.message);
      } else {
        await showFailureToast(err, { title: "Could not generate an address" });
      }
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    generate();
  }, []);

  async function submit(values: { label: string; note: string }) {
    if (!hme) return;
    if (!values.label.trim()) {
      await showToast({
        style: Toast.Style.Failure,
        title: "A label is required",
      });
      return;
    }

    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Reserving address",
    });
    try {
      const reserved = await reserveHme(hme, values.label.trim(), values.note);
      await Clipboard.copy(reserved.hme);
      toast.style = Toast.Style.Success;
      toast.title = "Copied to clipboard";
      toast.message = reserved.hme;
      onCreated?.();
      // Pop back to the list if we were pushed from it, otherwise close.
      if (onCreated) navigation.pop();
      else await popToRoot();
    } catch (err) {
      await showFailureToast(err, { title: "Could not reserve the address" });
    }
  }

  if (error) {
    return (
      <Form
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
              onAction={generate}
            />
          </ActionPanel>
        }
      >
        <Form.Description title="Not signed in" text={error} />
      </Form>
    );
  }

  return (
    <Form
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Reserve & Copy"
            icon={Icon.CheckCircle}
            onSubmit={submit}
          />
          <Action
            title="Regenerate Address"
            icon={Icon.ArrowClockwise}
            shortcut={{ modifiers: ["cmd"], key: "r" }}
            onAction={generate}
          />
        </ActionPanel>
      }
    >
      <Form.Description
        title="New Address"
        text={hme ?? (isLoading ? "Generating…" : "—")}
      />
      <Form.Separator />
      <Form.TextField
        id="label"
        title="Label"
        placeholder="e.g. Netflix, Newsletter, shop.example.com"
        info="Required. Helps you find this address later."
        autoFocus
      />
      <Form.TextArea
        id="note"
        title="Note"
        placeholder="Optional details about where this address is used"
      />
    </Form>
  );
}
