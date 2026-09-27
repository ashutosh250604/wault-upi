import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api, errorMessage } from "../lib/api";
import { emailError, nameError } from "../lib/validation";
import { useToast } from "../hooks/toast";
import { useAppSession } from "../session/context";
import { AppShell, AppBar } from "../components/AppShell";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Field, TextInput } from "../components/ui/Field";
import { Avatar } from "../components/ui/Avatar";
import { IconInfo } from "../components/ui/Icons";
import { StepDots } from "../components/ui/StepDots";

export default function SetNamePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { isAuthenticated, session, updateSession, patchProfile, refresh } =
    useAppSession();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  const nameIssue = touched ? nameError(name) : null;
  const emailIssue = touched ? emailError(email) : null;
  const canSubmit = !nameError(name) && !emailError(email);

  const submit = async () => {
    setTouched(true);
    if (!canSubmit) return;
    setBusy(true);
    setFormError(null);
    try {
      const data = await api.setName(name.trim(), email.trim());
      updateSession({ name: name.trim(), vpa: data.vpa });
      // The cached profile was fetched before the name existed; without the
      // patch the wallet greets a freshly-named user as "there".
      patchProfile({ name: name.trim(), vpa: data.vpa, is_verified: true });
      void refresh({ silent: true });
      toast.success("Profile created");
      navigate("/onboarding/pin", { replace: true });
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      header={
        <AppBar
          title="Your profile"
          right={<StepDots total={2} current={1} />}
          border={false}
        />
      }
      footer={
        <div className="shrink-0 border-t border-slate-100 bg-white px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button fullWidth size="lg" loading={busy} onClick={() => void submit()}>
            Continue
          </Button>
        </div>
      }
    >
      <div className="px-5 py-5">
        <div className="flex items-center gap-3">
          <Avatar name={name} size="lg" tone="gradient" />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold text-slate-900">
              {name.trim() || "Your name"}
            </p>
            <p className="text-[12.5px] text-slate-500">
              {session?.mobile ? `+91 ${session.mobile}` : "New PocketPay account"}
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-5">
          <Field
            label="Full name"
            error={nameIssue}
            hint="This is what payers see before they send you money."
          >
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                autoFocus
                autoComplete="name"
                placeholder="Aarav Sharma"
                maxLength={120}
                value={name}
                invalid={Boolean(nameIssue)}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submit();
                }}
              />
            )}
          </Field>

          <Field
            label="Email (optional)"
            error={emailIssue}
            hint="Used for your account record only — no email is ever sent in this demo."
          >
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                maxLength={254}
                value={email}
                invalid={Boolean(emailIssue)}
                onChange={(event) => setEmail(event.target.value)}
              />
            )}
          </Field>

          {formError ? (
            <p role="alert" className="text-[13px] font-medium text-rose-600">
              {formError}
            </p>
          ) : null}

          <Card tone="muted" className="flex gap-2.5">
            <IconInfo size={16} className="mt-px shrink-0 text-slate-400" />
            <p className="text-[12.5px] leading-relaxed text-slate-600">
              We'll create your UPI-style ID from your mobile number — for example{" "}
              <span className="font-mono font-semibold">9000000001@demoupi</span>. Next
              you'll set the 4-digit PIN that approves every payment.
            </p>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
