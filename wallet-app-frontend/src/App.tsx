import { lazy, Suspense, useEffect } from "react";
import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { RouteFallback } from "./components/RouteFallback";
import { feedback } from "./lib/feedback";
import { ToastProvider } from "./components/Toast";
import { SessionProvider } from "./session/SessionProvider";
import { useAppSession } from "./session/context";
import LoginPage from "./pages/Login";
import VerifyOtpPage from "./pages/VerifyOtp";
import SetNamePage from "./pages/SetName";
import SetPinPage from "./pages/SetPin";
import HomePage from "./pages/Home";
import HistoryPage from "./pages/History";
import ContactsPage from "./pages/Contacts";
import RequestsPage from "./pages/Requests";
import AccountsPage from "./pages/Accounts";
import AmountEntryPage from "./pages/AmountEntry";
import PaymentResultPage from "./pages/PaymentResult";
import ShowQrPage from "./pages/ShowQr";
import ProfilePage from "./pages/Profile";
import NotFoundPage from "./pages/NotFound";

// The QR scanner drags in a barcode-decoding engine, so it loads on demand
// instead of in the initial bundle.
const ScanQrPage = lazy(() => import("./pages/ScanQr"));

/**
 * Browsers refuse to play audio until the user has interacted, so the audio
 * context is created on the first real gesture rather than on mount.
 */
function AudioUnlock() {
  useEffect(() => {
    const unlock = () => feedback.unlock();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);
  return null;
}

/** Everything behind this needs a token; the session is read synchronously. */
function RequireSession({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAppSession();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** "/" resolves to the wallet or the sign-in screen depending on the session. */
function Landing() {
  const { isAuthenticated } = useAppSession();
  return <Navigate to={isAuthenticated ? "/home" : "/login"} replace />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <AudioUnlock />
      <BrowserRouter>
        <ToastProvider>
          <SessionProvider>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/verify-otp" element={<VerifyOtpPage />} />

              {/* Onboarding: signed in, but not yet able to pay */}
              <Route
                path="/onboarding/name"
                element={
                  <RequireSession>
                    <SetNamePage />
                  </RequireSession>
                }
              />
              <Route
                path="/onboarding/pin"
                element={
                  <RequireSession>
                    <SetPinPage />
                  </RequireSession>
                }
              />

              {/* Wallet */}
              <Route
                path="/home"
                element={
                  <RequireSession>
                    <HomePage />
                  </RequireSession>
                }
              />
              <Route
                path="/history"
                element={
                  <RequireSession>
                    <HistoryPage />
                  </RequireSession>
                }
              />
              <Route
                path="/requests"
                element={
                  <RequireSession>
                    <RequestsPage />
                  </RequireSession>
                }
              />
              <Route
                path="/accounts"
                element={
                  <RequireSession>
                    <AccountsPage />
                  </RequireSession>
                }
              />
              <Route
                path="/contacts"
                element={
                  <RequireSession>
                    <ContactsPage />
                  </RequireSession>
                }
              />
              <Route
                path="/scan"
                element={
                  <RequireSession>
                    <Suspense fallback={<RouteFallback title="Scan & pay" nav />}>
                      <ScanQrPage />
                    </Suspense>
                  </RequireSession>
                }
              />
              <Route
                path="/my-qr"
                element={
                  <RequireSession>
                    <ShowQrPage />
                  </RequireSession>
                }
              />
              <Route
                path="/profile"
                element={
                  <RequireSession>
                    <ProfilePage />
                  </RequireSession>
                }
              />

              {/* Payment flow */}
              <Route
                path="/pay/amount"
                element={
                  <RequireSession>
                    <AmountEntryPage />
                  </RequireSession>
                }
              />
              <Route
                path="/pay/result"
                element={
                  <RequireSession>
                    <PaymentResultPage />
                  </RequireSession>
                }
              />

              {/* Legacy paths from the first version of the app */}
              <Route path="/verify-otp/*" element={<Navigate to="/verify-otp" replace />} />
              <Route path="/balance" element={<Navigate to="/history" replace />} />
              <Route path="/linked-accounts" element={<Navigate to="/accounts" replace />} />
              <Route path="/money-requests" element={<Navigate to="/requests" replace />} />
              <Route path="/people" element={<Navigate to="/contacts" replace />} />
              <Route path="/scan-qr" element={<Navigate to="/scan" replace />} />
              <Route path="/show-qr" element={<Navigate to="/my-qr" replace />} />
              <Route path="/set-name" element={<Navigate to="/onboarding/name" replace />} />
              <Route path="/set-pin" element={<Navigate to="/onboarding/pin" replace />} />
              <Route path="/amount-entry" element={<Navigate to="/pay/amount" replace />} />
              <Route
                path="/payment-result"
                element={<Navigate to="/pay/result" replace />}
              />

              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </SessionProvider>
        </ToastProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
