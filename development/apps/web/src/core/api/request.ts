// Import the same deadline/cancellation implementation used by the main site.
import '../../../../../../public/request-runtime.js';
export type { RequestOptions } from '../../../../../../public/request-runtime.js';

export const requestRuntime = globalThis.freeBbsRequests;
