import { describe, expect, it } from 'vitest';
import {
  marketCreator,
  marketPath,
  marketSong,
  normalizeSlugKey,
  parseRoute,
} from '../src/lib/routes';
import { buildShareCopy, buildShareDisplayUrl, buildShareUrl } from '../src/lib/share';

describe('per-song slug routing & sharing', () => {
  it('routes /:creator/:song-slug to the dedicated public song stage', () => {
    expect(marketPath('malysh', 'Chasing the Antelope')).toBe('/malysh/Chasing-the-Antelope');
    expect(marketCreator('/malysh/Chasing-the-Antelope')).toBe('malysh');
    expect(marketSong('/malysh/Chasing-the-Antelope')).toBe('Chasing-the-Antelope');
    expect(parseRoute('/malysh/Chasing-the-Antelope')).toBe('song');
    expect(normalizeSlugKey('Chasing the Antelope')).toBe(normalizeSlugKey('Chasing-the-Antelope'));
  });

  it('keeps /:creator on the Creator Studio market view', () => {
    expect(marketCreator('/malysh')).toBe('malysh');
    expect(marketSong('/malysh')).toBeNull();
    expect(parseRoute('/malysh')).toBe('market');
    expect(parseRoute('/market')).toBe('market');
  });

  it('preserves studio, mypage, editor, and full-page video workstation routes', () => {
    expect(parseRoute('/')).toBe('studio');
    expect(parseRoute('/studio')).toBe('studio');
    expect(parseRoute('/my-page')).toBe('mypage');
    expect(parseRoute('/editor/sng-123')).toBe('editor');
  });

  it('builds share URLs and X post copy pointing directly to /:creator/:song-slug', () => {
    const url = buildShareUrl('malysh', 'Chasing the Antelope');
    expect(url.endsWith('/malysh/Chasing-the-Antelope')).toBe(true);
    expect(buildShareDisplayUrl('malysh', 'Chasing the Antelope')).toContain('/malysh/Chasing-the-Antelope');

    const copy = buildShareCopy({
      songId: 'sng-4803c94b-f77b-4781-9126-4ecc801e0c09',
      title: 'Chasing the Antelope',
      creator: 'malysh',
      creatorAddress: '0x4f5062Acf4009Fa24e94bd518a11b9e9BecD2E0e',
    });
    expect(copy).toContain('/malysh/Chasing-the-Antelope');
  });
});
