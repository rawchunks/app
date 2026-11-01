import { describe, it, expect } from 'vitest';
import { parseStrudelPattern } from '../../src/lib/daw/strudel';

describe('Strudel Polyphonic & Multi-Expr Stress Tests', () => {
  it('T1: Comma separated s() and note()', () => {
    const t1 = parseStrudelPattern('s("bd sd"), note("c3 e3")');
    expect(t1.events.length).toBe(4);
    expect(t1.events.filter((e) => e.type === 'sound').length).toBe(2);
    expect(t1.events.filter((e) => e.type === 'note').length).toBe(2);
  });

  it('T2: Newline separated s() and note()', () => {
    const t2 = parseStrudelPattern('s("bd sd")\nnote("c3 e3")');
    expect(t2.events.length).toBe(4);
    expect(t2.events.filter((e) => e.type === 'sound').length).toBe(2);
    expect(t2.events.filter((e) => e.type === 'note').length).toBe(2);
  });

  it('T3: Semicolon separated s() and note()', () => {
    const t3 = parseStrudelPattern('s("bd sd"); note("c3 e3")');
    expect(t3.events.length).toBe(4);
    expect(t3.events.filter((e) => e.type === 'sound').length).toBe(2);
    expect(t3.events.filter((e) => e.type === 'note').length).toBe(2);
  });

  it('T4: Mixed separators (comma, newline, semicolon, trailing/empty)', () => {
    const t4 = parseStrudelPattern('s("bd hh"),\n; note("c2 g2");\n\ns("cp*2")');
    expect(t4.events.length).toBe(6);
    expect(t4.events.filter((e) => e.type === 'sound').length).toBe(4);
    expect(t4.events.filter((e) => e.type === 'note').length).toBe(2);
  });

  it('T5: Multi-lane polyphony inside s("a, b, c")', () => {
    const t5 = parseStrudelPattern('s("bd sd, hh hh, cp")');
    expect(t5.events.length).toBe(5);
    expect(t5.events.filter((e) => e.time === 0).length).toBe(3);
  });

  it('T6: Euclidean rhythms inside multi-lane s("bd(3,8), hh(7,8)")', () => {
    const t6 = parseStrudelPattern('s("bd(3,8), hh(7,8)")');
    expect(t6.events.length).toBe(10);
  });

  it('T7: Commas inside brackets with top-level comma', () => {
    const t7 = parseStrudelPattern('s([bd, sd]), note([c3, e3])');
    expect(t7.events.length).toBe(4);
  });

  it('T8: Single quotes and double quotes mixing', () => {
    const t8 = parseStrudelPattern(`s('bd sd'), note("c3 e3")`);
    expect(t8.events.length).toBe(4);
  });

  it('T9: Unbalanced brackets resilience', () => {
    const t9 = parseStrudelPattern('s("bd sd", note("c3 e3"');
    expect(Array.isArray(t9.events)).toBe(true);
    expect(t9.events.length).toBeGreaterThan(0);
  });

  it('T10: Rate modifiers across multi-expressions (.fast(2) * .slow(2))', () => {
    const t10 = parseStrudelPattern('s("bd hh").fast(2), note("c3 e3").slow(2)');
    expect(t10.rateModifier).toBe(1.0);
  });

  it('T11: Non-positive / invalid rate modifiers guard', () => {
    const t11 = parseStrudelPattern('s("bd").fast(0).slow(-5).speed(NaN)');
    expect(t11.rateModifier).toBe(1.0);
  });

  it('T12: Euclidean edge cases (0 k, max k, k > n, zero n, negative n)', () => {
    const t12 = parseStrudelPattern('s("bd(0,8) sd(8,8) hh(9,8) perc(3,0) kick(3,-5)")');
    expect(Array.isArray(t12.events)).toBe(true);
    expect(t12.events.length).toBeGreaterThan(0);
  });

  it('T13: All multi-expression events are sorted chronologically by time', () => {
    const t13 = parseStrudelPattern('s("hh*4"), s("bd sd"), note("c2 e2 g2 b2")');
    let isSorted = true;
    for (let i = 1; i < t13.events.length; i++) {
      if (t13.events[i].time < t13.events[i - 1].time) {
        isSorted = false;
        break;
      }
    }
    expect(isSorted).toBe(true);
    expect(t13.events.length).toBe(10);
  });

  it('T14: Unwrapped note and drum pattern auto-detection', () => {
    const t14a = parseStrudelPattern('c3 e3 g3 b3');
    expect(t14a.events.length).toBe(4);
    expect(t14a.events.every((e) => e.type === 'note')).toBe(true);

    const t14b = parseStrudelPattern('bd sd hh cp');
    expect(t14b.events.length).toBe(4);
    expect(t14b.events.every((e) => e.type === 'sound')).toBe(true);
  });

  it('T15: Complex multi-line preset evaluation', () => {
    const t15 = parseStrudelPattern(
      's("bd [sd hh]*2").fast(2)\ns("bd(3,8), hh(7,8)").speed(1.2)\nnote("c3 e3 g3 b3").slow(2)'
    );
    expect(t15.events.length).toBeGreaterThan(10);
    expect(t15.rateModifier).toBeGreaterThan(0);
  });
});
