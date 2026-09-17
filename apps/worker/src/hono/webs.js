import app from './hono';
// Imported before security.js on purpose: i18n registers the per-request language
// scope, and security.js throws translated errors of its own, so the scope has to be
// established first.
import '../i18n/i18n';
import '../security/security';

import '../api/email-api';
import '../api/user-api';
import '../api/login-api';
import '../api/setting-api';
import '../api/account-api';
import '../api/star-api';
import '../api/r2-api';
import '../api/my-api';
import '../api/init-api';
import '../api/cli-api';
import '../api/unmatched-api';
import '../api/oauth-api';
import '../api/oauth-provider-api';
import '../api/oauth-provider-config-api';
import '../api/contact-api';
import '../api/site-asset-api';
import '../api/manifest-api';
import '../api/managed-domain-api';
import '../api/runtime-config-api';

export default app;
