import type { AgentSession } from '../../../core/contracts/sessions';
import type { WorkbenchSnapshot } from '../../../core/contracts/workbenchData';

export type SessionLibraryScope = 'all' | 'active' | 'archived';
export interface SessionLibraryResult {
  session: AgentSession;
  projectName: string;
  matchingExcerpt?: string;
}

function eventText(event: WorkbenchSnapshot['timelineEvents'][number]): string {
  if ('content' in event) return event.content;
  if (event.type === 'command') return `${event.command} ${event.outputSummary ?? ''}`;
  if (event.type === 'test') return event.command;
  if (event.type === 'approval') return event.request;
  return '';
}

export function searchSessionLibrary(
  snapshot: WorkbenchSnapshot,
  query: string,
  scope: SessionLibraryScope = 'all',
): SessionLibraryResult[] {
  const normalized = query.trim().toLocaleLowerCase();
  const projects = new Map(snapshot.projects.map((project) => [project.id, project.name]));
  return snapshot.sessions
    .filter((session) => scope === 'all' || (scope === 'archived') === Boolean(session.archived))
    .map((session) => {
      const matchingExcerpt = snapshot.timelineEvents
        .filter((event) => event.sessionId === session.id)
        .map(eventText)
        .find((value) => value.toLocaleLowerCase().includes(normalized));
      return { session, projectName: projects.get(session.projectId) ?? '', matchingExcerpt };
    })
    .filter(
      ({ session, projectName, matchingExcerpt }) =>
        !normalized ||
        [session.title, session.summary ?? '', projectName, matchingExcerpt ?? ''].some((value) =>
          value.toLocaleLowerCase().includes(normalized),
        ),
    )
    .sort((left, right) => right.session.updatedAt.localeCompare(left.session.updatedAt));
}

export function setSessionArchived(
  snapshot: WorkbenchSnapshot,
  sessionId: string,
  archived: boolean,
): WorkbenchSnapshot {
  if (!snapshot.sessions.some((session) => session.id === sessionId))
    throw new Error('The selected session does not exist.');
  return {
    ...snapshot,
    sessions: snapshot.sessions.map((session) =>
      session.id === sessionId ? { ...session, archived } : session,
    ),
  };
}
