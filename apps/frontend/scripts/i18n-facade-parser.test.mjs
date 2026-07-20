import assert from 'node:assert/strict';
import test from 'node:test';

import { parseMessageFunctionNames, parseMessageInputTypes } from './i18n-facade-parser.mjs';

test('parses Paraglide message declarations before and after 2.22', () => {
  const source = [
    'export type Common_CancelInputs = {};',
    'export type GreetingInputs = { name: NonNullable<unknown> };',
    'export const common_cancel: (inputs: Common_CancelInputs) => LocalizedString;',
    'export declare const greeting: (inputs: GreetingInputs) => LocalizedString;'
  ].join('\n');

  assert.deepEqual(parseMessageFunctionNames(source), ['common_cancel', 'greeting']);
  assert.deepEqual(
    [...parseMessageInputTypes(`${source}\n`)],
    [
      ['Common_CancelInputs', '{}'],
      ['GreetingInputs', '{ name: NonNullable<unknown> }']
    ]
  );
});
