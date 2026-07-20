BEGIN;

-- Staff authentication now uses Cognito's server-side API challenge flow.
-- The encrypted challenge transaction is short-lived browser state, so the
-- former hosted-login OAuth state table is no longer needed.
DROP TABLE IF EXISTS oauth_login_states;

COMMIT;
