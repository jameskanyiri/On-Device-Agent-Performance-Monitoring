import type { Task } from '../checks';
import { BARE_SUITE } from './bare';
import { FILE_TOOLS_SUITE } from './file-tools';
import { MULTI_STEP_SUITE } from './multi-step';

/*
 * Step 1: everything at once, so one eval compares the bare model against
 * file tools on all of it. The step-0 tasks show whether tools break what
 * already worked (and whether the model calls tools it doesn't need); the file
 * and multi-step tasks show what tools make possible. Bare's capital-of-kenya
 * stands in for file-tools' copy.
 */
const ids = new Set(BARE_SUITE.map((t) => t.id));
export const STEP_1_SUITE: Task[] = [...BARE_SUITE, ...FILE_TOOLS_SUITE.filter((t) => !ids.has(t.id)), ...MULTI_STEP_SUITE];
