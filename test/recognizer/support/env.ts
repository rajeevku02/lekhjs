// Shared set-up for the recognizer stage suites.
import { RECOGNIZER_CONFIG_DEFAULTS, recognizerConfigWith, type RecognizerConfig } from '../../../src/recognizer/core';
import type { RecognizerQuirks } from '../../../src/recognizer/core';
import { LineColl, stubLineAggregatorModule } from '../../../src/recognizer/lines';
import { PolyColl, type PolyEnv } from '../../../src/recognizer/polys';
import type { LineSet } from './lineSets';

export function makeEnv(quirks: RecognizerQuirks = {}, config: Partial<RecognizerConfig> = {}): PolyEnv {
  return {
    config: Object.keys(config).length === 0 ? RECOGNIZER_CONFIG_DEFAULTS : recognizerConfigWith(config),
    lineAggregator: stubLineAggregatorModule,
    quirks,
  };
}

/** C++ `CxPolyBudgetTest`'s `run`: the set through LineColl + PolyColl.process(). */
export function runPolys(set: LineSet, inOrder: boolean, env: PolyEnv = makeEnv()): { lc: LineColl; pc: PolyColl } {
  const lc = new LineColl(env.config);
  lc.addLines(set.lines());
  lc.setLineSearchInOrder(inOrder);
  const pc = new PolyColl(env);
  pc.setLines(lc);
  pc.process();
  return { lc, pc };
}
