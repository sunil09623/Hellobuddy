import { useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { API } from '../config';
import '../profile.css';

type SharedProfileData = {
  username: string;
  firstName: string | null;
  lastName: string | null;
  avatarData: string | null;
  avatarColor: string;
};

export function SharedProfile({ username }: { username: string }) {
  const [profile, setProfile] = useState<SharedProfileData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetch(`${API}/api/public/users/${encodeURIComponent(username)}`, { signal: controller.signal })
      .then(async response => {
        const data = await response.json().catch(() => ({})) as { profile?: SharedProfileData; error?: string };
        if (!response.ok || !data.profile) throw new Error(data.error || 'Unable to load this profile');
        setProfile(data.profile);
      })
      .catch(err => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Unable to load this profile');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [username]);

  const fullName = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ');
  const initials = `${profile?.firstName?.charAt(0) || ''}${profile?.lastName?.charAt(0) || ''}`.toUpperCase() || profile?.username.charAt(0).toUpperCase();

  return (
    <main className="shared-profile-page">
      <section className="shared-profile-card">
        <div className="shared-profile-brand"><MessageCircle size={23}/> HelloBuddy</div>
        {loading ? <p className="shared-profile-state">Loading profile…</p> : error ? <div className="error shared-profile-error" role="alert">{error}</div> : profile && <>
          <div className="shared-profile-avatar" style={{ backgroundColor: profile.avatarColor }}>
            {profile.avatarData ? <img src={profile.avatarData} alt=""/> : <span>{initials}</span>}
          </div>
          <h1>{fullName || profile.username}</h1>
          {fullName && <p className="shared-profile-username">@{profile.username}</p>}
          <p className="shared-profile-caption">HelloBuddy member</p>
        </>}
        <a className="shared-profile-open" href="/">Open HelloBuddy</a>
      </section>
    </main>
  );
}
