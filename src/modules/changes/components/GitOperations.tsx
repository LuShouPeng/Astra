import { GitBranch, GitCommit, GitMerge, RefreshCw } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import type {
  GitCheckoutRequest,
  GitCommitRequest,
  GitMergeRequest,
  GitResetRequest,
} from '../../../core/contracts/changes';
import type { Project } from '../../../core/contracts/projects';
import { useI18n } from '../../../core/i18n/I18nContext';
import type { TranslationKey } from '../../../core/i18n/translations';
import { ConfirmDialog } from '../../../shared/components/ConfirmDialog';
import type { ChangesService } from '../services/changesService';

interface GitOperationsProps {
  project: Project;
  service: ChangesService;
  onOperationComplete?: () => void;
}

type GitOperation = 'commit' | 'checkout' | 'merge' | 'reset';
type ResetType = GitResetRequest['resetType'];

const resetTypeKeys: Record<ResetType, TranslationKey> = {
  soft: 'changes.git.resetType.soft',
  mixed: 'changes.git.resetType.mixed',
  hard: 'changes.git.resetType.hard',
};

export function GitOperations({ project, service, onOperationComplete }: GitOperationsProps) {
  const { t, text } = useI18n();
  const [activeOperation, setActiveOperation] = useState<GitOperation | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [branchName, setBranchName] = useState('');
  const [createNewBranch, setCreateNewBranch] = useState(false);
  const [mergeBranchName, setMergeBranchName] = useState('');
  const [resetType, setResetType] = useState<ResetType>('mixed');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [hardResetConfirmationOpen, setHardResetConfirmationOpen] = useState(false);
  const resetInFlightRef = useRef(false);

  function toggleOperation(operation: GitOperation) {
    setActiveOperation((current) => (current === operation ? null : operation));
  }

  async function handleCommit(event: FormEvent) {
    event.preventDefault();
    const message = commitMessage.trim();
    if (!message || working) return;

    setWorking(true);
    setError(null);
    setNotice(null);

    try {
      const request: GitCommitRequest = { message };
      const result = await service.commit(project, request);
      setNotice(
        t('changes.git.commitSucceeded', {
          commitId: result.commitId.substring(0, 7),
          branch: result.branch,
        }),
      );
      setCommitMessage('');
      setActiveOperation(null);
      onOperationComplete?.();
    } catch (caught) {
      setError(caught instanceof Error ? text(caught.message) : t('changes.git.commitFailed'));
    } finally {
      setWorking(false);
    }
  }

  async function handleCheckout(event: FormEvent) {
    event.preventDefault();
    const nextBranchName = branchName.trim();
    if (!nextBranchName || working) return;

    setWorking(true);
    setError(null);
    setNotice(null);

    try {
      const request: GitCheckoutRequest = {
        branchName: nextBranchName,
        createNew: createNewBranch,
      };
      await service.checkout(project, request);
      setNotice(t('changes.git.checkoutSucceeded', { branch: nextBranchName }));
      setBranchName('');
      setCreateNewBranch(false);
      setActiveOperation(null);
      onOperationComplete?.();
    } catch (caught) {
      setError(caught instanceof Error ? text(caught.message) : t('changes.git.checkoutFailed'));
    } finally {
      setWorking(false);
    }
  }

  async function handleMerge(event: FormEvent) {
    event.preventDefault();
    const nextBranchName = mergeBranchName.trim();
    if (!nextBranchName || working) return;

    setWorking(true);
    setError(null);
    setNotice(null);

    try {
      const request: GitMergeRequest = { branchName: nextBranchName };
      const result = await service.merge(project, request);
      if (result.success) {
        setNotice(t('changes.git.mergeSucceeded', { branch: nextBranchName }));
        setMergeBranchName('');
        setActiveOperation(null);
        onOperationComplete?.();
      } else {
        setError(
          t('changes.git.mergeConflicts', {
            files: result.conflicts.join(', ') || t('common.notAvailable'),
          }),
        );
      }
    } catch (caught) {
      setError(caught instanceof Error ? text(caught.message) : t('changes.git.mergeFailed'));
    } finally {
      setWorking(false);
    }
  }

  async function handleReset() {
    if (working || resetInFlightRef.current) return;

    resetInFlightRef.current = true;
    setHardResetConfirmationOpen(false);
    setWorking(true);
    setError(null);
    setNotice(null);

    try {
      const request: GitResetRequest = { resetType };
      await service.reset(project, request);
      setNotice(t('changes.git.resetSucceeded', { type: t(resetTypeKeys[resetType]) }));
      setActiveOperation(null);
      onOperationComplete?.();
    } catch (caught) {
      setError(caught instanceof Error ? text(caught.message) : t('changes.git.resetFailed'));
    } finally {
      resetInFlightRef.current = false;
      setWorking(false);
    }
  }

  if (project.source !== 'local' || project.status !== 'available' || !project.gitRepository) {
    return null;
  }

  return (
    <div className="git-operations">
      <div className="git-operations__toolbar">
        <button
          className="button button--compact"
          disabled={working}
          onClick={() => toggleOperation('commit')}
        >
          <GitCommit size={15} aria-hidden="true" />
          {t('changes.git.commit')}
        </button>
        <button
          className="button button--compact"
          disabled={working}
          onClick={() => toggleOperation('checkout')}
        >
          <GitBranch size={15} aria-hidden="true" />
          {t('changes.git.checkout')}
        </button>
        <button
          className="button button--compact"
          disabled={working}
          onClick={() => toggleOperation('merge')}
        >
          <GitMerge size={15} aria-hidden="true" />
          {t('changes.git.merge')}
        </button>
        <button
          className="button button--compact"
          disabled={working}
          onClick={() => toggleOperation('reset')}
        >
          <RefreshCw size={15} aria-hidden="true" />
          {t('changes.git.reset')}
        </button>
      </div>

      {(notice || error) && (
        <div
          className={error ? 'git-feedback git-feedback--error' : 'git-feedback'}
          role={error ? 'alert' : 'status'}
        >
          {error ?? notice}
        </div>
      )}

      {activeOperation === 'commit' && (
        <form className="git-operation-form" onSubmit={(event) => void handleCommit(event)}>
          <label htmlFor="commit-message">{t('changes.git.commitMessage')}</label>
          <textarea
            id="commit-message"
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
            placeholder={t('changes.git.commitMessagePlaceholder')}
            rows={3}
            autoFocus
          />
          <div className="form-actions">
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setActiveOperation(null)}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="button button--primary"
              disabled={working || !commitMessage.trim()}
            >
              {working ? t('changes.git.committing') : t('changes.git.commitChanges')}
            </button>
          </div>
        </form>
      )}

      {activeOperation === 'checkout' && (
        <form className="git-operation-form" onSubmit={(event) => void handleCheckout(event)}>
          <label htmlFor="branch-name">{t('changes.git.branchName')}</label>
          <input
            id="branch-name"
            type="text"
            value={branchName}
            onChange={(event) => setBranchName(event.target.value)}
            placeholder={t('changes.git.branchNamePlaceholder')}
            autoFocus
          />
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={createNewBranch}
              onChange={(event) => setCreateNewBranch(event.target.checked)}
            />
            {t('changes.git.createBranch')}
          </label>
          <div className="form-actions">
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setActiveOperation(null)}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="button button--primary"
              disabled={working || !branchName.trim()}
            >
              {working ? t('changes.git.checkingOut') : t('changes.git.checkout')}
            </button>
          </div>
        </form>
      )}

      {activeOperation === 'merge' && (
        <form className="git-operation-form" onSubmit={(event) => void handleMerge(event)}>
          <label htmlFor="merge-branch-name">{t('changes.git.branchToMerge')}</label>
          <input
            id="merge-branch-name"
            type="text"
            value={mergeBranchName}
            onChange={(event) => setMergeBranchName(event.target.value)}
            placeholder={t('changes.git.branchToMergePlaceholder')}
            autoFocus
          />
          <div className="form-actions">
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setActiveOperation(null)}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="button button--primary"
              disabled={working || !mergeBranchName.trim()}
            >
              {working ? t('changes.git.merging') : t('changes.git.merge')}
            </button>
          </div>
        </form>
      )}

      {activeOperation === 'reset' && (
        <div className="git-operation-form">
          <label htmlFor="reset-type">{t('changes.git.resetType')}</label>
          <select
            id="reset-type"
            value={resetType}
            onChange={(event) => setResetType(event.target.value as ResetType)}
          >
            <option value="soft">{t('changes.git.resetType.soft')}</option>
            <option value="mixed">{t('changes.git.resetType.mixed')}</option>
            <option value="hard">{t('changes.git.resetType.hard')}</option>
          </select>
          <p className="warning-text">
            {resetType === 'hard' ? t('changes.git.hardResetWarning') : null}
          </p>
          <div className="form-actions">
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setActiveOperation(null)}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={working}
              onClick={() => {
                if (resetType === 'hard') {
                  setHardResetConfirmationOpen(true);
                  return;
                }
                void handleReset();
              }}
            >
              {working ? t('changes.git.resetting') : t('changes.git.resetToHead')}
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={hardResetConfirmationOpen}
        title={t('changes.git.hardResetTitle')}
        description={t('changes.git.hardResetDescription', { project: project.name })}
        confirmLabel={t('changes.git.discardChanges')}
        pending={working}
        onCancel={() => setHardResetConfirmationOpen(false)}
        onConfirm={() => void handleReset()}
      />
    </div>
  );
}
