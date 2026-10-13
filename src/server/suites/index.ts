import type { Task } from '../checks';
import { BARE_SUITE } from './bare';
import { CONTEXT_LENGTH_SUITE } from './context-length';
import { FILE_TOOLS_SUITE } from './file-tools';
import { SUSTAINED_SUITE } from './sustained';

/** Task suites by name (`npm run bench -- --suite <name>`), in roadmap order. */
export const SUITES: Record<string, Task[]> = {
  bare: BARE_SUITE,
  'context-length': CONTEXT_LENGTH_SUITE,
  sustained: SUSTAINED_SUITE,
  'file-tools': FILE_TOOLS_SUITE,
};
