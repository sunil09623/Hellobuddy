import { useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { Dashboard } from './components/Dashboard';
import { ForgotPassword } from './components/ForgotPassword';
import { Login } from './components/Login';
import { Register } from './components/Register';
import { SharedProfile } from './components/SharedProfile';
import { API } from './config';
import type { Gender, RelationshipStatus, User } from './types';
import './style.css';
import './theme.css';

type AuthScreen = 'login' | 'register' | 'forgot-password';
type StoredSession = { user: User | null; token: string };
const USER_STORAGE_KEY = 'hellobuddy_user';
const TOKEN_STORAGE_KEY = 'hellobuddy_token';

function readStoredSession(): StoredSession {
  const token = sessionStorage.getItem(TOKEN_STORAGE_KEY) || '';
  const rawUser = sessionStorage.getItem(USER_STORAGE_KEY);
  if (!token || !rawUser) return { user: null, token: '' };
  try {
    const parsed: unknown = JSON.parse(rawUser);
    if (typeof parsed === 'object' && parsed !== null) {
      const stored = parsed as Record<string, unknown>;
      if (typeof stored.id !== 'string' || typeof stored.username !== 'string') throw new Error('Invalid stored user');
      const gender: Gender | null = stored.gender === 'FEMALE' || stored.gender === 'MALE' || stored.gender === 'NON_BINARY' || stored.gender === 'OTHER' || stored.gender === 'PREFER_NOT_TO_SAY' ? stored.gender : null;
      const relationshipStatus: RelationshipStatus | null = stored.relationshipStatus === 'SINGLE' || stored.relationshipStatus === 'MARRIED' || stored.relationshipStatus === 'HIDDEN' ? stored.relationshipStatus : null;
      return {
        user: {
          id: stored.id,
          username: stored.username,
          email: typeof stored.email === 'string' ? stored.email : undefined,
          phoneNumber: typeof stored.phoneNumber === 'string' || stored.phoneNumber === null ? stored.phoneNumber : null,
          firstName: typeof stored.firstName === 'string' || stored.firstName === null ? stored.firstName : null,
          lastName: typeof stored.lastName === 'string' || stored.lastName === null ? stored.lastName : null,
          gender,
          dateOfBirth: typeof stored.dateOfBirth === 'string' || stored.dateOfBirth === null ? stored.dateOfBirth : null,
          relationshipStatus,
          avatarData: typeof stored.avatarData === 'string' || stored.avatarData === null ? stored.avatarData : null,
          avatarColor: typeof stored.avatarColor === 'string' ? stored.avatarColor : undefined
        },
        token
      };
    }
  } catch {
    sessionStorage.removeItem(USER_STORAGE_KEY);
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    return { user: null, token: '' };
  }
  sessionStorage.removeItem(USER_STORAGE_KEY);
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  return { user: null, token: '' };
}

function App() {
  const [session, setSession] = useState<StoredSession>(readStoredSession);
  const { user, token } = session;
  const sharedProfileUsername = new URLSearchParams(window.location.search).get('profile')?.trim();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authScreen, setAuthScreen] = useState<AuthScreen>('login');
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);

  function showAuthScreen(screen: AuthScreen) {
    setAuthError('');
    setAuthScreen(screen);
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>, route: 'login' | 'register') {
    event.preventDefault();
    setAuthError('');
    setAuthBusy(true);
    try {
      const payload = route === 'register'
        ? { email: email.trim().toLowerCase(), username: username.trim(), password }
        : { email: email.trim().toLowerCase(), password };
      const response = await fetch(`${API}/api/auth/${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({})) as { user?: User; token?: string; error?: string };
      if (!response.ok) throw new Error(data.error || `Authentication failed (${response.status})`);
      if (!data.user || !data.token) throw new Error('Invalid authentication response');
      sessionStorage.setItem(USER_STORAGE_KEY, JSON.stringify(data.user));
      sessionStorage.setItem(TOKEN_STORAGE_KEY, data.token);
      setSession({ user: data.user, token: data.token });
      setPassword('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed';
      setAuthError(message.includes('fetch') ? `Cannot reach HelloBuddy server at ${API}. Start the backend and database first.` : message);
    } finally {
      setAuthBusy(false);
    }
  }

  function logout() {
    sessionStorage.removeItem(USER_STORAGE_KEY);
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    setSession({ user: null, token: '' });
    setPassword('');
    setAuthScreen('login');
  }

  function updateUser(nextUser: User) {
    sessionStorage.setItem(USER_STORAGE_KEY, JSON.stringify(nextUser));
    setSession(current => ({ ...current, user: nextUser }));
  }

  function updateToken(nextToken: string) {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, nextToken);
    setSession(current => ({ ...current, token: nextToken }));
  }

  if (sharedProfileUsername) return <SharedProfile username={sharedProfileUsername}/>;

  if (user && token) {
    return <Dashboard user={user} token={token} onUserChange={updateUser} onTokenChange={updateToken} onLogout={logout}/>;
  }

  if (authScreen === 'register') {
    return <Register
      email={email}
      username={username}
      password={password}
      busy={authBusy}
      error={authError}
      onEmailChange={setEmail}
      onUsernameChange={setUsername}
      onPasswordChange={setPassword}
      onSubmit={event => submitAuth(event, 'register')}
      onLogin={() => showAuthScreen('login')}
    />;
  }

  if (authScreen === 'forgot-password') {
    return <ForgotPassword onBackToLogin={() => showAuthScreen('login')}/>;
  }

  return <Login
    email={email}
    password={password}
    busy={authBusy}
    error={authError}
    onEmailChange={setEmail}
    onPasswordChange={setPassword}
    onSubmit={event => submitAuth(event, 'login')}
    onRegister={() => showAuthScreen('register')}
    onForgotPassword={() => showAuthScreen('forgot-password')}
  />;
}

createRoot(document.getElementById('root')!).render(<App/>);
