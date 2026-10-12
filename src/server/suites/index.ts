import type { Task } from '../checks';
import { FILE_TOOLS_SUITE } from './file-tools';

/** Task suites by name (`npm run bench -- --suite <name>`). */
export const SUITES: Record<string, Task[]> = {
  'file-tools': FILE_TOOLS_SUITE,
};
