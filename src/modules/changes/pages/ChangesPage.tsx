import { ChangesReview } from '../components/ChangesReview';
import type { ChangesService } from '../services/changesService';

export function ChangesPage({ service }: { service?: ChangesService }) {
  return (
    <div className="changes-page">
      <header className="changes-header">
        <div>
          <p className="eyebrow">Workspace review</p>
          <h1>Review Changes</h1>
        </div>
        <p>Review decisions update prototype metadata only.</p>
      </header>
      <ChangesReview service={service} />
    </div>
  );
}
