import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// No incremental cache override: the app has no ISR or fetch caching to persist.
// The calls route is `revalidate = 0`, and the token route is dynamic.
export default defineCloudflareConfig({});
