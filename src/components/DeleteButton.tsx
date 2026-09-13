import { Check, Trash2, X } from "lucide-react";
import { useState } from "react";
import { IconButton } from "./ui";

export function DeleteButton({
  name,
  onDelete,
}: {
  name: string;
  onDelete: () => Promise<void>;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <span
      className="delete-control"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          setConfirm(false);
        }
      }}
    >
      {confirm ? (
        <>
          <IconButton
            label={`Confirm delete ${name}`}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onDelete();
              } finally {
                setBusy(false);
                setConfirm(false);
              }
            }}
          >
            <Check size={14} />
          </IconButton>
          <IconButton
            label="Cancel deletion"
            disabled={busy}
            onClick={() => setConfirm(false)}
          >
            <X size={14} />
          </IconButton>
        </>
      ) : (
        <IconButton label={`Delete ${name}`} onClick={() => setConfirm(true)}>
          <Trash2 size={14} />
        </IconButton>
      )}
    </span>
  );
}
