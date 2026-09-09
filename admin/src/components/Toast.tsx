import { Alert, Snackbar } from "@mui/material";
import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from "react";

type Severity = "success" | "error" | "info";
interface ToastState {
  message: string;
  severity: Severity;
}
interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** 全ルートの祖先に置く。mutation の onSuccess/onError から useToast() で呼ぶ。 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);

  const show = useCallback((severity: Severity) => (message: string) => setToast({ message, severity }), []);
  const api = useMemo<ToastApi>(
    () => ({ success: show("success"), error: show("error"), info: show("info") }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Snackbar
        open={toast !== null}
        autoHideDuration={3000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      >
        {toast ? (
          <Alert severity={toast.severity} variant="filled" onClose={() => setToast(null)} sx={{ width: "100%" }}>
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
