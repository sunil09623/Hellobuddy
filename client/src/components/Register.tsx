import type { FormEvent } from 'react';
import { AuthShell } from './AuthShell';

type RegisterProps = {
  email: string;
  username: string;
  password: string;
  busy: boolean;
  error: string;
  onEmailChange: (email: string) => void;
  onUsernameChange: (username: string) => void;
  onPasswordChange: (password: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onLogin: () => void;
};

export function Register({
  email, username, password, busy, error, onEmailChange, onUsernameChange, onPasswordChange, onSubmit, onLogin
}: RegisterProps) {
  return (
    <AuthShell title="Create your account" subtitle="Join HelloBuddy and start chatting.">
      <form className="auth-form" onSubmit={onSubmit}>
        <div className="auth-tabs">
          <button type="button" onClick={onLogin}>Login</button>
          <button type="button" className="active">Register</button>
        </div>
        <label htmlFor="register-email">Email address</label>
        <input id="register-email" placeholder="you@example.com" type="email" autoComplete="email" value={email} onChange={event => onEmailChange(event.target.value)} required/>
        <label htmlFor="register-username">Username</label>
        <input id="register-username" placeholder="Choose a username (3–24 characters)" autoComplete="username" value={username} onChange={event => onUsernameChange(event.target.value)} minLength={3} maxLength={24} pattern="[a-zA-Z0-9_]+" required/>
        <label htmlFor="register-password">Password</label>
        <input id="register-password" placeholder="At least 10 characters" type="password" autoComplete="new-password" value={password} onChange={event => onPasswordChange(event.target.value)} minLength={10} required/>
        <button type="submit" disabled={busy}>{busy ? 'Please wait…' : 'Create account'}</button>
        {error && <div className="error">{error}</div>}
        <button type="button" className="link-button" onClick={onLogin}>Already have an account? Log in</button>
      </form>
    </AuthShell>
  );
}
