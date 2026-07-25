import { GitBranch, GitCommit, GitMerge, RefreshCw } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type {
  GitCommitRequest,
  GitCheckoutRequest,
  GitMergeRequest,
  GitResetRequest,
} from '../../../core/contracts/changes';
import type { Project } from '../../../core/contracts/projects';
import { useI18n } from '../../../core/i18n/I18nContext';
import type { ChangesService } from '../services/changesService';

interface GitOperationsProps {
  project: Project;
  service: ChangesService;
  onOperationComplete?: () => void;
}

export function GitOperations({ project, service, onOperationComplete }: GitOperationsProps) {
  const { text } = useI18n();
  const [activeOperation, setActiveOperation] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [branchName, setBranchName] = useState('');
  const [createNewBranch, setCreateNewBranch] = useState(false);
  const [mergeBranchName, setMergeBranchName] = useState('');
  const [resetType, setResetType] = useState<'soft' | 'mixed' | 'hard'>('mixed');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function handleCommit(event: FormEvent) {
    event.preventDefault();
    if (!commitMessage.trim() || working) return;

    setWorking(true);
    setError(null);
    setNotice(null);

    try {
      const request: GitCommitRequest = {
        message: commitMessage,
      };
      const result = await service.commit(project, request);
      setNotice(`Committed ${result.commitId.substring(0, 7)} to ${result.branch}`);
      setCommitMessage('');
      setActiveOperation(null);
      onOperationComplete?.();
    } catch (caught) {
      setError(caught instanceof Error ? text(caught.message) : 'Commit failed');
    } finally {
      setWorking(false);
    }
  }

  async function handleCheckout(event: FormEvent) {
    event.preventDefault();
    if (!branchName.trim() || working) return;

    setWorking(true);
    setError(null);
    setNotice(null);

    try {
      const request: GitCheckoutRequest = {
        branchName,
        createNew: createNewBranch,
      };
      await service.checkout(project, request);
      setNotice(`Checked out ${createNewBranch ? 'new ' : ''}branch: ${branchName}`);
      setBranchName('');
      setCreateNewBranch(false);
      setActiveOperation(null);
      onOperationComplete?.();
    } catch (caught) {
      setError(caught instanceof Error ? text(caught.message) : 'Checkout failed');
    } finally {
      setWorking(false);
    }
  }

  async function handleMerge(event: FormEvent) {
    event.preventDefault();
    if (!mergeBranchName.trim() || working) return;

    setWorking(true);
    setError(null);
    setNotice(null);

    try {
      const request: GitMergeRequest = {
        branchName: mergeBranchName,
      };
      const result = await service.merge(project, request);
      if (result.success) {
        setNotice(`Successfully merged ${mergeBranchName}`);
        setMergeBranchName('');
        setActiveOperation(null);
        onOperationComplete?.();
      } else {
        setError(`Merge conflicts detected in: ${result.conflicts.join(', ')}`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? text(caught.message) : 'Merge failed');
    } finally {
      setWorking(false);
    }
  }

  async function handleReset() {
    if (working) return;

    setWorking(true);
    setError(null);
    setNotice(null);

    try {
      const request: GitResetRequest = {
        resetType,
      };
      await service.reset(project, request);
      setNotice(`Reset to HEAD (${resetType})`);
      setActiveOperation(null);
      onOperationComplete?.();
    } catch (caught) {
      setError(caught instanceof Error ? text(caught.message) : 'Reset failed');
    } finally {
      setWorking(false);
    }
  }

  if (project.source !== 'local' || project.status !== 'available') {
    return (
      <div className="git-operations-unavailable">
        <p>Git operations are only available for local projects.</p>
      </div>
    );
  }

  return (
    <div className="git-operations">
      <div className="git-operations__toolbar">
        <button
          className="button button--compact"
          disabled={working}
          onClick={() =>
            setActiveOperation(activeOperation === 'commit' ? null : 'commit')
          }
        >
          <GitCommit size={15} aria-hidden="true" />
          Commit
        </button>
        <button
          className="button button--compact"
          disabled={working}
          onClick={() =>
            setActiveOperation(activeOperation === 'checkout' ? null : 'checkout')
          }
        >
          <GitBranch size={15} aria-hidden="true" />
          Checkout
        </button>
        <button
          className="button button--compact"
          disabled={working}
          onClick={() =>
            setActiveOperation(activeOperation === 'merge' ? null : 'merge')
          }
        >
          <GitMerge size={15} aria-hidden="true" />
          Merge
        </button>
        <button
          className="button button--compact"
          disabled={working}
          onClick={() =>
            setActiveOperation(activeOperation === 'reset' ? null : 'reset')
          }
        >
          <RefreshCw size={15} aria-hidden="true" />
          Reset
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
        <form className="git-operation-form" onSubmit={(e) => void handleCommit(e)}>
          <label htmlFor="commit-message">Commit Message</label>
          <textarea
            id="commit-message"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="Enter commit message..."
            rows={3}
            autoFocus
          />
          <div className="form-actions">
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setActiveOperation(null)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="button button--primary"
              disabled={working || !commitMessage.trim()}
            >
              {working ? 'Committing...' : 'Commit Changes'}
            </button>
          </div>
        </form>
      )}

      {activeOperation === 'checkout' && (
        <form className="git-operation-form" onSubmit={(e) => void handleCheckout(e)}>
          <label htmlFor="branch-name">Branch Name</label>
          <input
            id="branch-name"
            type="text"
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            placeholder="Enter branch name..."
            autoFocus
          />
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={createNewBranch}
              onChange={(e) => setCreateNewBranch(e.target.checked)}
            />
            Create new branch
          </label>
          <div className="form-actions">
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setActiveOperation(null)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="button button--primary"
              disabled={working || !branchName.trim()}
            >
              {working ? 'Checking out...' : 'Checkout'}
            </button>
          </div>
        </form>
      )}

      {activeOperation === 'merge' && (
        <form className="git-operation-form" onSubmit={(e) => void handleMerge(e)}>
          <label htmlFor="merge-branch-name">Branch to Merge</label>
          <input
            id="merge-branch-name"
            type="text"
            value={mergeBranchName}
            onChange={(e) => setMergeBranchName(e.target.value)}
            placeholder="Enter branch name to merge..."
            autoFocus
          />
          <div className="form-actions">
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setActiveOperation(null)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="button button--primary"
              disabled={working || !mergeBranchName.trim()}
            >
              {working ? 'Merging...' : 'Merge'}
            </button>
          </div>
        </form>
      )}

      {activeOperation === 'reset' && (
        <div className="git-operation-form">
          <label htmlFor="reset-type">Reset Type</label>
          <select
            id="reset-type"
            value={resetType}
            onChange={(e) => setResetType(e.target.value as 'soft' | 'mixed' | 'hard')}
          >
            <option value="soft">Soft (keep changes staged)</option>
            <option value="mixed">Mixed (unstage changes)</option>
            <option value="hard">Hard (discard all changes)</option>
          </select>
          <p className="warning-text">
            {resetType === 'hard' && '⚠️ Warning: This will discard all uncommitted changes!'}
          </p>
          <div className="form-actions">
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setActiveOperation(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={working}
              onClick={() => void handleReset()}
            >
              {working ? 'Resetting...' : 'Reset to HEAD'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
