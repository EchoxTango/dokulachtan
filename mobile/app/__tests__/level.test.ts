import { levelFromQcStatements, levelLabel } from '../src/lib/level';

describe('levelFromQcStatements', () => {
  it('maps QcCompliance to ades', () => {
    expect(levelFromQcStatements(['QcCompliance'])).toBe('ades');
  });

  it('maps QcCompliance + QcSSCD to qes', () => {
    expect(levelFromQcStatements(['QcCompliance', 'QcSSCD'])).toBe('qes');
  });

  it('returns none without QcCompliance (QcSSCD alone is not QES)', () => {
    expect(levelFromQcStatements(['QcSSCD'])).toBe('none');
    expect(levelFromQcStatements([])).toBe('none');
  });

  it('labels levels', () => {
    expect(levelLabel('qes')).toBe('QES');
    expect(levelLabel('ades')).toBe('AdES');
    expect(levelLabel('none')).toBe('—');
  });
});
