import type { FormEvent } from 'react';
import { AuthShell } from './AuthShell';

type LoginProps = {
  email: string;
  password: string;
  busy: boolean;
  error: string;
  onEmailChange: (email: string) => void;
  onPasswordChange: (password: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRegister: () => void;
  onForgotPassword: () => void;
};

export function Login({
  email, password, busy, error, onEmailChange, onPasswordChange, onSubmit, onRegister, onForgotPassword
}: LoginProps) {
  return (
    <AuthShell title="Welcome back" subtitle="Log in to continue your conversations.">
      <form className="auth-form" onSubmit={onSubmit}>
        <label htmlFor="login-email">Email address</label>
        <input id="login-email" placeholder="you@example.com" type="email" autoComplete="email" value={email} onChange={event => onEmailChange(event.target.value)} required/>
        <label htmlFor="login-password">Password</label>
        <input id="login-password" placeholder="Your password" type="password" autoComplete="current-password" value={password} onChange={event => onPasswordChange(event.target.value)} required/>
        <button type="submit" disabled={busy}>{busy ? 'Please wait…' : 'Log in'}</button>
        {error && <div className="error">{error}</div>}
        <button type="button" className="link-button" onClick={onForgotPassword}>Forgot password?</button>
        <button type="button" className="link-button" onClick={onRegister}>New to HeyBuddy? Create account</button>
      </form>
    </AuthShell>
  );
}
