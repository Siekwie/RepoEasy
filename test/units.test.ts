import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseRepoName } from '../src/shared/repo-input.ts';
import { backupDb, backupDue, listBackups } from '../src/server/backup.ts';
import { badgeSvg, compact } from '../src/server/badges.ts';
import { verifyStripeSignature } from '../src/server/billing.ts';
import { decrypt, encrypt } from '../src/server/crypto.ts';
import { addDays, dayOf, openDb } from '../src/server/db.ts';
import { crossedMilestone, isPublicAddress } from '../src/server/events.ts';
import { csv, forwardedAddress } from '../src/server/http.ts';

describe('crypto', () => {
  it('round-trips and never stores the plain token', () => {
    const blob = encrypt('gho_secret_value');
    expect(blob).not.toContain('gho_secret_value');
    expect(decrypt(blob)).toBe('gho_secret_value');
    expect(encrypt('gho_secret_value')).not.toBe(blob);
  });

  it('rejects tampered values', () => {
    const parts = encrypt('abc').split('.');
    parts[3] = Buffer.from('xyz').toString('base64url');
    expect(() => decrypt(parts.join('.'))).toThrow();
  });
});

describe('helpers', () => {
  it('parses repository references', () => {
    expect(parseRepoName('facebook/react')).toEqual({ host: 'github', owner: 'facebook', name: 'react' });
    expect(parseRepoName(' https://github.com/BurntSushi/ripgrep/issues/1 ')).toEqual({ host: 'github', owner: 'BurntSushi', name: 'ripgrep' });
    expect(parseRepoName('git@github.com:vladkens/ghstats.git')).toEqual({ host: 'github', owner: 'vladkens', name: 'ghstats' });
    expect(parseRepoName('github.com/a/b.js')).toEqual({ host: 'github', owner: 'a', name: 'b.js' });
    expect(parseRepoName('ssh://git@github.com/a/b.git')).toEqual({ host: 'github', owner: 'a', name: 'b' });
    expect(parseRepoName('just-a-name')).toBeNull();
    expect(parseRepoName('https://example.com/a/b')).toBeNull();
  });

  it('detects milestones', () => {
    expect(crossedMilestone(95, 104)).toBe(100);
    expect(crossedMilestone(8, 300)).toBe(250);
    expect(crossedMilestone(100, 120)).toBeNull();
    expect(crossedMilestone(120, 90)).toBeNull();
  });

  it('formats compact numbers and badges', () => {
    expect([999, 1000, 1540, 43_680, 250_000, 1_200_000].map(compact)).toEqual(['999', '1k', '1.5k', '43.7k', '250k', '1.2M']);
    expect(badgeSvg('a<b', '1')).toContain('a&#60;b');
  });

  it('escapes CSV cells and neutralises formulas', () => {
    expect(csv(['a', 'b'], [['x,y', 1], ['=SUM(A1)', null], ['say "hi"', -5]])).toBe('a,b\r\n"x,y",1\r\n\'=SUM(A1),\r\n"say ""hi""",-5\r\n');
  });

  it('does day arithmetic in UTC', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-12-31', 1)).toBe('2025-01-01');
    expect(dayOf('2026-10-04T23:59:59Z')).toBe('2026-10-04');
  });

  it('reads the client address a trusted proxy reported', () => {
    expect(forwardedAddress('203.0.113.7', 1)).toBe('203.0.113.7');
    // anything left of the trusted hops was sent by the client itself
    expect(forwardedAddress('1.1.1.1, 203.0.113.7', 1)).toBe('203.0.113.7');
    expect(forwardedAddress('1.1.1.1, 203.0.113.7, 10.0.0.2', 2)).toBe('203.0.113.7');
    expect(forwardedAddress('203.0.113.7', 2)).toBeNull();
    expect(forwardedAddress(undefined, 1)).toBeNull();
    expect(forwardedAddress('203.0.113.7', 0)).toBeNull();
  });

  it('applies migrations once', () => {
    const db = openDb(':memory:');
    expect(db.pragma('user_version', { simple: true })).toBeGreaterThan(0);
    expect(() => db.prepare('SELECT * FROM traffic_daily').all()).not.toThrow();
  });
});

describe('backups', () => {
  it('writes restorable snapshots and keeps only the newest', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'repoeasy-backup-'));
    try {
      const db = openDb(':memory:');
      db.prepare(`INSERT INTO users (login, created_at) VALUES ('alice', '2026-01-01')`).run();
      expect(backupDue(dir, 24)).toBe(true);

      const start = Date.UTC(2026, 0, 1, 3, 0, 0);
      const day = 86_400_000;
      for (let i = 0; i < 4; i++) await backupDb(db, dir, 3, new Date(start + i * day));
      expect(listBackups(dir).map((b) => b.file)).toEqual([
        'repoeasy-20260104T030000Z.db',
        'repoeasy-20260103T030000Z.db',
        'repoeasy-20260102T030000Z.db',
      ]);
      expect(backupDue(dir, 24, start + 3 * day + 3_600_000)).toBe(false);
      expect(backupDue(dir, 24, start + 4 * day)).toBe(true);
      expect(backupDue(dir, 0, start + 400 * day)).toBe(false); // switched off

      const copy = openDb(join(dir, 'repoeasy-20260104T030000Z.db'));
      expect(copy.prepare('SELECT login FROM users').get()).toEqual({ login: 'alice' });
      copy.close();
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('webhook targets', () => {
  it('accepts only public unicast addresses', () => {
    for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111']) expect(isPublicAddress(ip), ip).toBe(true);
    for (const ip of [
      '127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '198.18.0.1', '192.0.0.1', '224.0.0.1',
      '::1', '::', '::ffff:127.0.0.1', '::ffff:7f00:1', '::127.0.0.1', '64:ff9b::7f00:1', 'fd00::1', 'fe80::1', 'fec0::1', 'ff02::1',
      'not-an-ip', '',
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });
});

describe('stripe signatures', () => {
  const secret = 'whsec_test';
  const sign = (body: string, t: number) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

  it('accepts a fresh, correctly signed payload only', () => {
    const body = '{"type":"x"}';
    const now = Math.floor(Date.now() / 1000);
    expect(verifyStripeSignature(body, sign(body, now), secret)).toBe(true);
    expect(verifyStripeSignature(`${body} `, sign(body, now), secret)).toBe(false);
    expect(verifyStripeSignature(body, sign(body, now - 3600), secret)).toBe(false);
    expect(verifyStripeSignature(body, sign(body, now), 'whsec_other')).toBe(false);
    expect(verifyStripeSignature(body, '', secret)).toBe(false);
  });
});
