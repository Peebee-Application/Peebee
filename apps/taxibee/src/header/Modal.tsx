import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { useNavBack, useNavPrimaryAction } from "../../../customer/lib/nav-primary-action";

// The Customer Modal also mounts its own BottomNav. Taxibee already has one.
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const action = useNavPrimaryAction();
  const back = useNavBack();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog ref={ref} aria-labelledby={titleId} className="taxibee-header-dialog"
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}>
    <div className="flex items-center justify-between gap-3">
      <h2 id={titleId} className="text-lg font-bold">{title}</h2>
      <button type="button" aria-label={back ? "Back" : "Close"} onClick={back ?? onClose} className="flex h-11 w-11 items-center justify-center"><X size={22} /></button>
    </div>
    {children}
    {action && !action.confirmation && <button type="button" className="d-btn d-btn-gold" disabled={action.disabled || action.busy}
      onClick={() => void action.onClick()}>{action.label} {action.detail}</button>}
  </dialog>;
}
