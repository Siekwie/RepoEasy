import { describe, expect, it } from 'vitest';
import { parseRepoName } from '../../src/shared/repo-input.ts';

describe('parseRepoName', () => {
  it('accepts owner/name', () => {
    expect(parseRepoName('vercel/next.js')).toEqual({ host: 'github', owner: 'vercel', name: 'next.js' });
    expect(parseRepoName('  a/b  ')).toEqual({ host: 'github', owner: 'a', name: 'b' });
  });

  it('accepts github.com URLs with and without the scheme', () => {
    const want = { host: 'github', owner: 'owner', name: 'repo' };
    expect(parseRepoName('https://github.com/owner/repo')).toEqual(want);
    expect(parseRepoName('http://github.com/owner/repo')).toEqual(want);
    expect(parseRepoName('https://www.github.com/owner/repo')).toEqual(want);
    expect(parseRepoName('github.com/owner/repo')).toEqual(want);
    expect(parseRepoName('www.github.com/owner/repo')).toEqual(want);
    expect(parseRepoName('GitHub.com/owner/repo')).toEqual(want);
  });

  it('accepts clone URLs', () => {
    const want = { host: 'github', owner: 'owner', name: 'repo' };
    expect(parseRepoName('https://github.com/owner/repo.git')).toEqual(want);
    expect(parseRepoName('git@github.com:owner/repo.git')).toEqual(want);
    expect(parseRepoName('ssh://git@github.com/owner/repo.git')).toEqual(want);
    expect(parseRepoName('git://github.com/owner/repo.git')).toEqual(want);
  });

  it('ignores trailing paths, queries, fragments and slashes', () => {
    const want = { host: 'github', owner: 'owner', name: 'repo' };
    expect(parseRepoName('https://github.com/owner/repo/')).toEqual(want);
    expect(parseRepoName('https://github.com/owner/repo/issues/12')).toEqual(want);
    expect(parseRepoName('github.com/owner/repo/tree/main/src')).toEqual(want);
    expect(parseRepoName('https://github.com/owner/repo?tab=readme')).toEqual(want);
    expect(parseRepoName('https://github.com/owner/repo#readme')).toEqual(want);
  });

  it('keeps dots and dashes in names', () => {
    expect(parseRepoName('a-b/c_d.e-f')).toEqual({ host: 'github', owner: 'a-b', name: 'c_d.e-f' });
    expect(parseRepoName('o/name.git.js')).toEqual({ host: 'github', owner: 'o', name: 'name.git.js' });
  });

  it('never mistakes the host for the owner (the old client parser turned github.com/owner/repo into github.com/owner)', () => {
    expect(parseRepoName('github.com/owner/repo')).not.toEqual({ host: 'github', owner: 'github.com', name: 'owner' });
  });

  it('recognises codeberg.org links, where user names may hold dots and underscores', () => {
    const want = { host: 'codeberg', owner: 'forgejo', name: 'forgejo' };
    expect(parseRepoName('https://codeberg.org/forgejo/forgejo')).toEqual(want);
    expect(parseRepoName('codeberg.org/forgejo/forgejo/releases')).toEqual(want);
    expect(parseRepoName('git@codeberg.org:forgejo/forgejo.git')).toEqual(want);
    expect(parseRepoName('Codeberg.org/some.user_x/repo')).toEqual({ host: 'codeberg', owner: 'some.user_x', name: 'repo' });
    expect(parseRepoName('some.user_x/repo')).toBeNull();
    expect(parseRepoName('https://codeberg.org/forgejo')).toBeNull();
    expect(parseRepoName('codeberg.org/forgejo/..')).toBeNull();
  });

  it('rejects things that are not repositories', () => {
    expect(parseRepoName('')).toBeNull();
    expect(parseRepoName('   ')).toBeNull();
    expect(parseRepoName('just-a-name')).toBeNull();
    expect(parseRepoName('owner/')).toBeNull();
    expect(parseRepoName('/repo')).toBeNull();
    expect(parseRepoName('https://example.com/owner/repo')).toBeNull();
    expect(parseRepoName('https://github.com/')).toBeNull();
    expect(parseRepoName('https://github.com/owner')).toBeNull();
    expect(parseRepoName('owner/re po')).toBeNull();
    expect(parseRepoName('-owner/repo')).toBeNull();
  });
});
