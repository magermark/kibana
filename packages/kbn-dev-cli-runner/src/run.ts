/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */

import { pickLevelFromFlags, ToolingLog, LogLevel } from '@kbn/tooling-log';
import { ProcRunner, withProcRunner } from '@kbn/dev-proc-runner';
import { createFlagError } from '@kbn/dev-cli-errors';

import { Flags, getFlags, FlagOptions, DEFAULT_FLAG_ALIASES } from './flags';
import { FlagsReader } from './flags_reader';
import { getHelp } from './help';
import { CleanupTask, Cleanup } from './cleanup';
import { Metrics, MetricsMeta } from './metrics';

export interface RunContext {
  log: ToolingLog;
  flags: Flags;
  procRunner: ProcRunner;
  statsMeta: MetricsMeta;
  addCleanupTask: (task: CleanupTask) => void;
  flagsReader: FlagsReader;
}
export type RunFn = (context: RunContext) => Promise<void> | void;

export interface RunOptions {
  usage?: string;
  description?: string;
  log?: {
    defaultLevel?: LogLevel;
  };
  flags?: FlagOptions;
}

export async function run(fn: RunFn, options: RunOptions = {}) {
  const flags = getFlags(process.argv.slice(2), options.flags, options.log?.defaultLevel);
  const log = new ToolingLog({
    level: pickLevelFromFlags(flags, {
      default: options.log?.defaultLevel,
    }),
    writeTo: process.stdout,
  });

  const metrics = new Metrics(log);
  const helpText = getHelp({
    description: options.description,
    usage: options.usage,
    flagHelp: options.flags?.help,
    defaultLogLevel: options.log?.defaultLevel,
    examples: options.flags?.examples,
  });

  if (flags.help) {
    log.write(helpText);
    process.exit();
  }

  const cleanup = Cleanup.setup(log, helpText);

  if (!options.flags?.allowUnexpected && flags.unexpected.length) {
    const error = createFlagError(`Unknown flag(s) "${flags.unexpected.join('", "')}"`);
    cleanup.execute(error);
    return;
  }

  try {
    await withProcRunner(log, async (procRunner) => {
      await fn({
        log,
        flags,
        procRunner,
        statsMeta: metrics.meta,
        addCleanupTask: cleanup.add.bind(cleanup),
        flagsReader: new FlagsReader(flags, {
          aliases: {
            ...options.flags?.alias,
            ...DEFAULT_FLAG_ALIASES,
          },
        }),
      });
    });
  } catch (error) {
    cleanup.execute(error);
    await metrics.reportError(error?.message);
    // process.exitCode is set by `cleanup` when necessary
    process.exit();
  } finally {
    cleanup.execute();
  }

  await metrics.reportSuccess();
}
