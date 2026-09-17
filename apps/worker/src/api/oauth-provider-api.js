import app from '../hono/hono';
import oauthProviderService from '../service/oauth-provider-service';

app.get('/oauth/authorize', c => oauthProviderService.authorize(c));
app.post('/oauth/token', c => oauthProviderService.token(c));
app.get('/oauth/userinfo', c => oauthProviderService.userinfo(c));
app.get('/.well-known/oauth-authorization-server', c => oauthProviderService.metadata(c));
