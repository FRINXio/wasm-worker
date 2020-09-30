/**
 * Copyright 2004-present Facebook. All Rights Reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 */
import {escapeJson} from './utils.js';
import {executeWasmer} from './wasmer.js';

const quickJsPath = process.env.QUICKJS_PATH || 'wasm/quickjs/quickjs.wasm';

export async function executeQuickJs(
  script: string,
  args: string[],
  inputData: mixed,
) {
  const escapedInputDataJson = escapeJson(inputData);
  script = `
const $ = JSON.parse(${escapedInputDataJson});
console.error = function(...args) {
  std.err.puts(args.join(' '));
  std.err.puts('\\n');
}
console.log = console.error;
log = console.error;
print = function(...args) {
  std.out.puts(args.join(' '));
}
let result = function() {
${script}
}();
if (result != null) {
  if (typeof result === 'object') {
    result = JSON.stringify(result);
  }
  std.out.puts(result);
}
`;
  // --std: enable std for out, err objects
  const wasmerArgs = [quickJsPath, '--', '--std', '-e', script];
  try {
    const {stdout, stderr} = await executeWasmer(wasmerArgs);
    console.info('executeQuickJs succeeded', {stdout, stderr});
    return {stdout, stderr};
  } catch (error) {
    console.warn('executeQuickJs failed', {script, args, error});
    throw error;
  }
}

export async function quickJsHealthCheck() {
  try {
    const {stdout, stderr} = await executeQuickJs(`
      console.log('console.log');
      log('log');
      console.error('console.error');
      print("print\\n");
      return 'result';
      `,
      [],
      {},
    );
    if (stdout == 'print\nresult' && stderr == 'console.log\nlog\nconsole.error\n') {
      return true;
    }
    console.warn('Unexpected healthcheck result', {stdout, stderr});
  } catch (error) {
    console.warn('Unexpected healthcheck error', {error});
  }
  return false;
}
