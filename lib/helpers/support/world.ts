// Re-export CustomWorld so Cucumber picks it up as the World constructor.
// All step definitions reference CustomWorld via `this: CustomWorld`.
export { CustomWorld } from '../world/CustomWorld';

// Load .env for the current TEST_ENV before any hooks or steps run.
import { loadEnv } from '@utils/env';
loadEnv();

// Set step timeout to 60 s for all UI/API/DB steps.
// The YAML `timeout:` key is not reliably applied in Cucumber v11 —
// setDefaultTimeout() is the only guaranteed mechanism.
import { setDefaultTimeout } from '@cucumber/cucumber';
setDefaultTimeout(60_000);
