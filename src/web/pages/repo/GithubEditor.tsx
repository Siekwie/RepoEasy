import { useState, type FormEvent } from 'react';
import type { RepoDetail, RepoSummary } from '../../../shared/api.ts';
import { useApp } from '../../context.tsx';
import { api } from '../../lib/api.ts';
import { Card } from '../../components/ui.tsx';

export function GithubEditor({ repo, onSaved }: { repo: RepoDetail; onSaved: (u: RepoSummary) => void }) {
  const { fail, toast } = useApp();
  const [description, setDescription] = useState(repo.description ?? '');
  const [homepage, setHomepage] = useState(repo.homepage ?? '');
  const [topics, setTopics] = useState(repo.topics.join(', '));
  const [saving, setSaving] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const list = Array.from(new Set(topics.split(/[\s,]+/).map((t) => t.trim().toLowerCase()).filter(Boolean)));
      const u = await api.patchRepoGithub(repo.id, { description: description.trim(), homepage: homepage.trim(), topics: list });
      onSaved(u);
      setTopics(list.join(', '));
      toast('Saved to GitHub', 'success');
    } catch (err) {
      fail(err);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Card title="Edit on GitHub" sub="Saving writes straight to the repository on GitHub. Needs admin access.">
      <form className="form" onSubmit={(e) => void save(e)}>
        <label className="field">
          <span className="field-label">Description</span>
          <input type="text" value={description} maxLength={350} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Homepage</span>
          <input type="url" value={homepage} placeholder="https://" onChange={(e) => setHomepage(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Topics</span>
          <input type="text" value={topics} placeholder="react, analytics, github" onChange={(e) => setTopics(e.target.value)} />
          <span className="field-hint">Separate with commas or spaces. Lowercase letters, numbers and hyphens.</span>
        </label>
        <div>
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save to GitHub'}
          </button>
        </div>
      </form>
    </Card>
  );
}
