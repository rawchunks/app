import { parseStrudelPattern, ParsedStrudelPattern } from '../strudelEvaluator';

export function runPolyphonicStressTests() {
  console.log('====================================================');
  console.log('   STRUDEL POLYPHONIC & MULTI-EXPR STRESS TESTS      ');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assertTest(name: string, condition: boolean, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${name}`);
      passed++;
    } else {
      console.error(`[FAIL] ${name}${detail ? ` -> ${detail}` : ''}`);
      failed++;
    }
  }

  // 1. Multi-expression comma separation
  const t1 = parseStrudelPattern('s("bd sd"), note("c3 e3")');
  assertTest(
    'T1: Comma separated s() and note()',
    t1.events.length === 4 &&
      t1.events.filter((e) => e.type === 'sound').length === 2 &&
      t1.events.filter((e) => e.type === 'note').length === 2,
    `got ${t1.events.length} events`
  );

  // 2. Multi-expression newline separation
  const t2 = parseStrudelPattern('s("bd sd")\nnote("c3 e3")');
  assertTest(
    'T2: Newline separated s() and note()',
    t2.events.length === 4 &&
      t2.events.filter((e) => e.type === 'sound').length === 2 &&
      t2.events.filter((e) => e.type === 'note').length === 2,
    `got ${t2.events.length} events`
  );

  // 3. Multi-expression semicolon separation
  const t3 = parseStrudelPattern('s("bd sd"); note("c3 e3")');
  assertTest(
    'T3: Semicolon separated s() and note()',
    t3.events.length === 4 &&
      t3.events.filter((e) => e.type === 'sound').length === 2 &&
      t3.events.filter((e) => e.type === 'note').length === 2,
    `got ${t3.events.length} events`
  );

  // 4. Mixed separators with whitespace & newlines
  const t4 = parseStrudelPattern('s("bd hh"),\n; note("c2 g2");\n\ns("cp*2")');
  assertTest(
    'T4: Mixed separators (comma, newline, semicolon, trailing/empty)',
    t4.events.length === 6 &&
      t4.events.filter((e) => e.type === 'sound').length === 4 &&
      t4.events.filter((e) => e.type === 'note').length === 2,
    `got ${t4.events.length} events`
  );

  // 5. Polyphony inside quotes (lanes separated by comma inside s("..."))
  const t5 = parseStrudelPattern('s("bd sd, hh hh, cp")');
  assertTest(
    'T5: Multi-lane polyphony inside s("a, b, c")',
    t5.events.length === 5 &&
      t5.events.filter((e) => e.time === 0).length === 3, // bd, hh, cp at t=0
    `got ${t5.events.length} events, ${t5.events.filter((e) => e.time === 0).length} at t=0`
  );

  // 6. Polyphony inside quotes + Euclidean
  const t6 = parseStrudelPattern('s("bd(3,8), hh(7,8)")');
  assertTest(
    'T6: Euclidean rhythms inside multi-lane s("bd(3,8), hh(7,8)")',
    t6.events.length === 10, // 3 bd + 7 hh
    `got ${t6.events.length} events`
  );

  // 7. Commas inside brackets / parens top-level
  const t7 = parseStrudelPattern('s([bd, sd]), note([c3, e3])');
  assertTest(
    'T7: Commas inside brackets with top-level comma',
    t7.events.length === 4,
    `got ${t7.events.length} events`
  );

  // 8. Single and double quotes mixing
  const t8 = parseStrudelPattern(`s('bd sd'), note("c3 e3")`);
  assertTest(
    'T8: Single quotes and double quotes mixing',
    t8.events.length === 4,
    `got ${t8.events.length} events`
  );

  // 9. Unbalanced brackets/parens resilience
  const t9 = parseStrudelPattern('s("bd sd", note("c3 e3"');
  assertTest(
    'T9: Unbalanced brackets resilience',
    Array.isArray(t9.events) && t9.events.length > 0,
    `got ${t9.events.length} events`
  );

  // 10. Rate modifiers across multi-expression
  const t10 = parseStrudelPattern('s("bd hh").fast(2), note("c3 e3").slow(2)');
  assertTest(
    'T10: Rate modifiers across multi-expressions (.fast(2) * .slow(2))',
    t10.rateModifier === 1.0,
    `got rateModifier = ${t10.rateModifier}`
  );

  // 11. Extreme rate modifier values (.fast(0), .slow(-5), .speed(NaN))
  const t11 = parseStrudelPattern('s("bd").fast(0).slow(-5).speed(NaN)');
  assertTest(
    'T11: Non-positive / invalid rate modifiers guard',
    t11.rateModifier === 1.0,
    `got rateModifier = ${t11.rateModifier}`
  );

  // 12. Euclidean rhythm edge cases
  const t12 = parseStrudelPattern('s("bd(0,8) sd(8,8) hh(9,8) perc(3,0) kick(3,-5)")');
  assertTest(
    'T12: Euclidean edge cases (0 k, max k, k > n, zero n, negative n)',
    Array.isArray(t12.events) && t12.events.length > 0,
    `got ${t12.events.length} events`
  );

  // 13. Event time ordering check
  const t13 = parseStrudelPattern('s("hh*4"), s("bd sd"), note("c2 e2 g2 b2")');
  let isSorted = true;
  for (let i = 1; i < t13.events.length; i++) {
    if (t13.events[i].time < t13.events[i - 1].time) {
      isSorted = false;
      break;
    }
  }
  assertTest(
    'T13: All multi-expression events are sorted chronologically by time',
    isSorted && t13.events.length === 10,
    `sorted=${isSorted}, length=${t13.events.length}`
  );

  // 14. Plain un-wrapped note mini-notation vs drum mini-notation
  const t14a = parseStrudelPattern('c3 e3 g3 b3');
  assertTest(
    'T14a: Unwrapped note pattern auto-detection',
    t14a.events.length === 4 && t14a.events.every((e) => e.type === 'note'),
    `got ${t14a.events.length} events, types=${t14a.events.map((e) => e.type).join(',')}`
  );

  const t14b = parseStrudelPattern('bd sd hh cp');
  assertTest(
    'T14b: Unwrapped drum pattern auto-detection',
    t14b.events.length === 4 && t14b.events.every((e) => e.type === 'sound'),
    `got ${t14b.events.length} events, types=${t14b.events.map((e) => e.type).join(',')}`
  );

  // 15. Complex multi-line polyphonic preset string from UI
  const t15 = parseStrudelPattern(
    's("bd [sd hh]*2").fast(2)\ns("bd(3,8), hh(7,8)").speed(1.2)\nnote("c3 e3 g3 b3").slow(2)'
  );
  assertTest(
    'T15: Complex multi-line preset evaluation',
    t15.events.length > 10 && t15.rateModifier > 0,
    `got ${t15.events.length} events, rateModifier=${t15.rateModifier}`
  );

  console.log('\n====================================================');
  console.log(`STRESS TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  return { passed, failed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { failed } = runPolyphonicStressTests();
  process.exit(failed > 0 ? 1 : 0);
}
