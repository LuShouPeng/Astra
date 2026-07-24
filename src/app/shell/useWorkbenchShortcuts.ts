import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const altRoutes: Record<string, string> = {
  '1': '/command-center',
  '2': '/projects',
  '3': '/attention',
  '4': '/notifications',
  '5': '/changes',
  '6': '/settings',
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export function useWorkbenchShortcuts(): void {
  const navigate = useNavigate();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return;
      const route = event.altKey && !event.ctrlKey && !event.metaKey ? altRoutes[event.key] : null;
      if (route) {
        event.preventDefault();
        void navigate(route);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === ',') {
        event.preventDefault();
        void navigate('/settings');
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate]);
}
