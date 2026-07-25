import { useMemo, useState } from 'react';
import type { Project } from '../../../core/contracts/projects';
import { ChangesReview } from '../components/ChangesReview';
import { GitOperations } from '../components/GitOperations';
import type { ChangesService } from '../services/changesService';
import { useI18n } from '../../../core/i18n/I18nContext';
import { useWorkbench } from '../../../core/state/WorkbenchContext';

function canManageGit(project: Project): boolean {
  return project.source === 'local' && project.status === 'available' && project.gitRepository;
}

export function ChangesPage({ service }: { service?: ChangesService }) {
  const { t } = useI18n();
  const { snapshot } = useWorkbench();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const gitProjects = useMemo(
    () => snapshot?.projects.filter(canManageGit) ?? [],
    [snapshot?.projects],
  );
  const selectedProject =
    gitProjects.find((project) => project.id === selectedProjectId) ?? gitProjects[0];

  return (
    <div className="changes-page">
      <header className="changes-header">
        <div>
          <p className="eyebrow">{t('changes.eyebrow')}</p>
          <h1>{t('changes.pageTitle')}</h1>
        </div>
        <p>{t('changes.prototypeOnly')}</p>
      </header>
      {service && selectedProject && (
        <section className="changes-git-section" aria-label={t('changes.gitOperations')}>
          <header className="changes-git-section__project">
            <span>{t('changes.gitOperations')}</span>
            {gitProjects.length > 1 ? (
              <label>
                <span>{t('changes.gitProject')}</span>
                <select
                  aria-label={t('changes.gitProject')}
                  value={selectedProject.id}
                  onChange={(event) => setSelectedProjectId(event.target.value)}
                >
                  {gitProjects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <strong>{selectedProject.name}</strong>
            )}
            <small>{selectedProject.rootPath}</small>
          </header>
          <GitOperations project={selectedProject} service={service} />
        </section>
      )}
      <ChangesReview service={service} />
    </div>
  );
}
