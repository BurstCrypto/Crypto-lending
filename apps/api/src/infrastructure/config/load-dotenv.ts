import { config } from 'dotenv';

// dotenv 17 may emit informational text. Runtime output is an allowlisted JSON
// boundary, so local .env loading must always be silent.
config({ quiet: true });
