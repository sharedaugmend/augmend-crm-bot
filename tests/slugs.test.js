'use strict';
const slugs = require('../config/slugs');

describe('slug config', () => {
  test('all keys are slug-format (lowercase, dashes)', () => {
    for (const k of Object.keys(slugs)) {
      expect(k).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  test('all values are valid Slack channel names (<=80, lowercase, dashes)', () => {
    for (const v of Object.values(slugs)) {
      expect(v.length).toBeLessThanOrEqual(80);
      expect(v).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
    }
  });

  test('no duplicate channel names in values', () => {
    const values = Object.values(slugs);
    const dupes = values.filter((v, i) => values.indexOf(v) !== i);
    expect(dupes).toEqual([]);
  });

  test('no value uses reserved closed- prefix', () => {
    for (const v of Object.values(slugs)) {
      expect(v.startsWith('closed-')).toBe(false);
    }
  });
});
