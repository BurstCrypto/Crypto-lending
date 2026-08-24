import { config } from 'dotenv';

// dotenv 17 may emit informational text. Runtime output is an allowlisted JSON
// boundary, so local .env loading must always be silent.
// The guarded demo supplies a complete, sanitized environment. Loading an
// ignored developer file afterward would reintroduce ambient credentials.
if (process.env.LOCAL_DEMO_MODE !== 'enabled') config({ quiet: true });
