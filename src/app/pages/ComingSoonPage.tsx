import { Construction } from 'lucide-react';
import { useLocation } from 'react-router-dom';

const labels: Record<string, string> = {
  projects: 'Projects',
  sessions: 'Session',
  attention: 'Needs Attention',
  changes: 'Changes',
  settings: 'Settings',
};

export function ComingSoonPage() {
  const location = useLocation();
  const segment = location.pathname.split('/').filter(Boolean)[0] ?? 'page';
  return (
    <div className="route-placeholder">
      <Construction size={24} aria-hidden="true" />
      <h1>{labels[segment] ?? 'Page'}</h1>
      <p>This surface is queued for the next implementation slice.</p>
    </div>
  );
}
