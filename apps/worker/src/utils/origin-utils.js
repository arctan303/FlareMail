import runtimeConfigService from '../service/runtime-config-service';

export async function isAllowedOrigin(c, origin) {
	if (!origin) return false;
	try {
		const normalized = new URL(origin).origin;
		if (normalized !== origin) return false;
		if (normalized === new URL(c.req.url).origin) return true;
		const runtime = await runtimeConfigService.private(c);
		return runtime.allowedOrigins.includes(normalized);
	} catch {
		return false;
	}
}
