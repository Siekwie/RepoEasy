import { useRef, useState, type KeyboardEvent } from 'react';
import type { RepoDetail, RepoPatch, RepoSummary } from '../../../shared/api.ts';
import { Icon } from '../../components/Icon.tsx';

const sameTags = (a: string[], b: string[]) => a.length === b.length && a.every((t, i) => t === b[i]);

export function TagsAndNote({ repo, busy, onPatch }: { repo: RepoDetail; busy: boolean; onPatch: (p: RepoPatch) => Promise<RepoSummary | null> }) {
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState(repo.note ?? '');
  const noteDirty = note.trim() !== (repo.note ?? '');

  // Tags are edited locally first and saved one request at a time. Building each save from `repo.tags`
  // (which only updates after the server answers) made two quick edits overwrite each other.
  const [tags, setTags] = useState(repo.tags);
  const wanted = useRef(tags);
  const confirmed = useRef(repo.tags);
  const queue = useRef<Promise<void>>(Promise.resolve());
  // Backspace in the empty field first "arms" the last tag (highlighted); a second press removes it
  const [armed, setArmed] = useState(false);

  function commit(next: string[]) {
    wanted.current = next;
    setTags(next);
    queue.current = queue.current.then(async () => {
      const send = wanted.current; // newest wish, so a burst of edits becomes one request
      if (sameTags(send, confirmed.current)) return;
      const saved = await onPatch({ tags: send });
      if (!saved) {
        // failed (already reported): go back to what the server has, unless newer edits are queued behind us
        if (wanted.current === send) {
          wanted.current = confirmed.current;
          setTags(confirmed.current);
        }
        return;
      }
      confirmed.current = saved.tags;
      // the server trims, de-duplicates and caps tags; show what it actually stored
      if (wanted.current === send) {
        wanted.current = saved.tags;
        setTags(saved.tags);
      }
    });
  }

  function add() {
    const v = draft.trim().replace(/,+$/, '').trim();
    if (!v) return;
    setDraft('');
    setArmed(false);
    if (wanted.current.some((t) => t.toLowerCase() === v.toLowerCase())) return;
    commit([...wanted.current, v]);
  }
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    } else if (e.key === 'Backspace' && !draft && tags.length) {
      if (e.repeat) return; // holding the key must not arm and delete in one go
      if (armed) {
        setArmed(false);
        commit(wanted.current.slice(0, -1));
      } else setArmed(true);
    } else if (e.key !== 'Shift' && e.key !== 'Tab') {
      setArmed(false);
    }
  }
  const last = tags[tags.length - 1];
  return (
    <div className="tags-note">
      <div className="field">
        <span className="field-label" id="tags-label">
          Your tags
        </span>
        <div className="tag-input" role="group" aria-labelledby="tags-label">
          {tags.map((t) => (
            <span className={`tag tag-removable ${armed && t === last ? 'is-armed' : ''}`} key={t}>
              {t}
              <button type="button" onClick={() => commit(wanted.current.filter((x) => x !== t))} aria-label={`Remove tag ${t}`}>
                <Icon name="x" size={11} />
              </button>
            </span>
          ))}
          <input
            type="text"
            value={draft}
            maxLength={30}
            onChange={(e) => {
              setDraft(e.target.value);
              setArmed(false);
            }}
            onKeyDown={onKey}
            onBlur={() => {
              setArmed(false);
              add();
            }}
            placeholder={tags.length ? 'Add tag' : 'Add tags to group repositories'}
            aria-label="Add a tag"
          />
        </div>
        <span className="sr-only" role="status">
          {armed && last ? `Press Backspace again to remove the tag ${last}.` : ''}
        </span>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="repo-note">
          Private note
        </label>
        <div className="note-edit">
          <textarea id="repo-note" rows={2} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder="Only you can see this" />
          <button type="button" className="btn btn-sm" disabled={!noteDirty || busy} onClick={() => void onPatch({ note: note.trim() || null })}>
            Save note
          </button>
        </div>
      </div>
    </div>
  );
}
