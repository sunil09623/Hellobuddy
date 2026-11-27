import { AuthShell } from './AuthShell';

type ForgotPasswordProps = { onBackToLogin: () => void };

export function ForgotPassword({ onBackToLogin }: ForgotPasswordProps) {
  return (
    <AuthShell title="Forgot password" subtitle="Get help accessing your account.">
      <div className="auth-form">
        <p className="forgot-password-note">Password reset is not configured yet. Contact your administrator for help accessing your account.</p>
        <button type="button" className="link-button" onClick={onBackToLogin}>Back to login</button>
      </div>
    </AuthShell>
  );
}
