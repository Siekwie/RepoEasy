import { describe, expect, it } from 'vitest';
import { failed, initialSlot, patched, sameDeps, started, succeeded, toError, view, type FetchSlot } from '../../src/web/lib/fetch-state.ts';

const A = ['overview', '30d'];
const B = ['overview', '90d'];

describe('sameDeps', () => {
  it('compares element by element', () => {
    expect(sameDeps(['a', 1, true], ['a', 1, true])).toBe(true);
    expect(sameDeps(['a', 1], ['a', 2])).toBe(false);
    expect(sameDeps(['a'], ['a', 'b'])).toBe(false);
    expect(sameDeps([], [])).toBe(true);
  });
  it('is false before anything has been fetched', () => {
    expect(sameDeps(null, [])).toBe(false);
  });
  it('uses Object.is, so NaN equals itself and 0 differs from -0', () => {
    expect(sameDeps([NaN], [NaN])).toBe(true);
    expect(sameDeps([0], [-0])).toBe(false);
  });
});

describe('view: a result only belongs to the key it was fetched for', () => {
  const loadedA = succeeded<string>(A, 'data for 30d');

  it('starts loading with nothing', () => {
    expect(view(initialSlot<string>(), A)).toEqual({ data: null, error: null, loading: true });
  });

  it('shows data for its own key', () => {
    expect(view(loadedA, A)).toEqual({ data: 'data for 30d', error: null, loading: false });
  });

  it('hides data from another key straight away, in the very render where the key changes', () => {
    expect(view(loadedA, B)).toEqual({ data: null, error: null, loading: true });
  });

  it('keeps showing data while refetching the same key (reload after a sync): no flicker', () => {
    const s = started(loadedA);
    expect(view(s, A)).toEqual({ data: 'data for 30d', error: null, loading: true });
  });

  it('shows the new data once it lands and forgets the old key', () => {
    const s = succeeded<string>(B, 'data for 90d');
    expect(view(s, B).data).toBe('data for 90d');
    expect(view(s, A).data).toBeNull();
  });
});

describe('failures', () => {
  const err = new Error('nope');

  it('a failed refetch of the same key keeps its data and reports the error', () => {
    const s = failed(started(succeeded<string>(A, 'old')), A, err);
    expect(view(s, A)).toEqual({ data: 'old', error: err, loading: false });
  });

  it('after a key change, a failure never leaves the old key data on screen', () => {
    const s = failed(started(succeeded<string>(A, 'old')), B, err);
    expect(view(s, B)).toEqual({ data: null, error: err, loading: false });
  });

  it('an error does not leak into another key', () => {
    const s = failed(started(succeeded<string>(A, 'old')), B, err);
    // user flips back to A before the next request settles: A's data is correct for A, B's error is not
    expect(view(s, A)).toMatchObject({ data: 'old', error: null });
  });

  it('retrying clears the error', () => {
    const s = started(failed(initialSlot<string>(), A, err));
    expect(view(s, A)).toEqual({ data: null, error: null, loading: true });
  });

  it('a first-ever failure has no data', () => {
    expect(view(failed(initialSlot<string>(), A, err), A)).toEqual({ data: null, error: err, loading: false });
  });
});

describe('patched (optimistic edits)', () => {
  it('edits the current data with a value or an updater', () => {
    const s = succeeded<number[]>(A, [1, 2]);
    expect(view(patched(s, A, [9]), A).data).toEqual([9]);
    expect(view(patched(s, A, (p) => [...(p ?? []), 3]), A).data).toEqual([1, 2, 3]);
  });

  it('ignores edits aimed at data that belongs to another key', () => {
    const s: FetchSlot<number[]> = succeeded(A, [1, 2]);
    expect(patched(s, B, [9])).toBe(s);
  });

  it('ignores edits before anything loaded', () => {
    const s = initialSlot<number[]>();
    expect(patched(s, A, [9])).toBe(s);
  });
});

describe('toError', () => {
  it('passes errors through and wraps everything else', () => {
    const e = new Error('x');
    expect(toError(e)).toBe(e);
    expect(toError('boom').message).toBe('boom');
  });
});
