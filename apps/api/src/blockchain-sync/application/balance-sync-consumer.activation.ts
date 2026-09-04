/**
 * Code-reviewed activation boundary for the balance consumer executable.
 * Environment configuration cannot override this value. Enabling it requires
 * a source change alongside the remaining database, IAM, and runtime review.
 */
export const BALANCE_CONSUMER_SOURCE_ACTIVATION = Object.freeze({
  enabled: false as boolean,
});
