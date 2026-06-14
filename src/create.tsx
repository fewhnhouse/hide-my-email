import {
  Action,
  ActionPanel,
  Clipboard,
  Form,
  Icon,
  popToRoot,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { useEffect, useRef, useState } from "react";
import { generateHme, reserveHme } from "./icloud";
import { AuthGate } from "./auth-gate";

interface CreateFormProps {
  /** Called after a successful reservation, e.g. to refresh the search list. */
  onCreated?: () => void;
}

/** The create form itself. Assumes iCloud auth has already succeeded. */
export function CreateForm({ onCreated }: CreateFormProps) {
  const navigation = useNavigation();
  const [hme, setHme] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(true);
  // Guards against React's double-invoked mount effect (StrictMode) generating
  // — and the submit handler reserving — an address twice.
  const didGenerate = useRef(false);
  const isReserving = useRef(false);

  async function generate() {
    setIsLoading(true);
    try {
      setHme(await generateHme());
    } catch (err) {
      await showFailureToast(err, { title: "Could not generate an address" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (didGenerate.current) return;
    didGenerate.current = true;
    generate();
  }, []);

  async function submit(values: { label: string; note: string }) {
    if (!hme || isReserving.current) return;
    if (!values.label.trim()) {
      await showToast({
        style: Toast.Style.Failure,
        title: "A label is required",
      });
      return;
    }

    isReserving.current = true;
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
      isReserving.current = false;
      await showFailureToast(err, { title: "Could not reserve the address" });
    }
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

export default function CreateCommand() {
  return <AuthGate>{() => <CreateForm />}</AuthGate>;
}
