import type { ReactNode } from 'react';
import { Check, MessageCircle } from 'lucide-react';

type AuthShellProps = { title: string; subtitle: string; children: ReactNode };

export function AuthShell({ title, subtitle, children }: AuthShellProps) {
  return (
    <main className="auth-page">
      <div className="auth-card">
        <section className="auth-brand-panel">
          <div className="auth-brand-mark"><MessageCircle size={42} strokeWidth={2.5}/></div>
          <h2>HelloBuddy</h2>
          <p>Chat. Connect. Be happy.</p>
          <div className="auth-feature-card">
            <strong>Good conversations start here</strong>
            <ul>
              <li><Check size={16}/>One-to-one messaging</li>
              <li><Check size={16}/>Live delivery and read status</li>
              <li><Check size={16}/>Find people and chat easily</li>
            </ul>
          </div>
        </section>
        <section className="auth-panel">
          <div className="auth-panel-heading"><h1>{title}</h1><p>{subtitle}</p></div>
          {children}
        </section>
      </div>
    </main>
  );
}
