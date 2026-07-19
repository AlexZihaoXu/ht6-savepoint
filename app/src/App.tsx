import { BrowserRouter } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { ToastProvider } from "./components/Toast";

export function App() {
  return (
    <BrowserRouter>
      {/* Toasts sit above the router outlet so they survive navigation — the
          record screen navigates away and THEN reports "saved". */}
      <ToastProvider>
        <AppShell />
      </ToastProvider>
    </BrowserRouter>
  );
}

export default App;
