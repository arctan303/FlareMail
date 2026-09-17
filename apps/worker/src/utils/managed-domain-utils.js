import verifyUtils from './verify-utils';

export function managedDomains(value) {
	let domains = value;
	if (typeof domains === 'string') {
		const trimmed = domains.trim();
		if (!trimmed) return [];
		try {
			domains = JSON.parse(trimmed);
		} catch {
			domains = trimmed.split(',');
		}
	}
	if (!Array.isArray(domains)) domains = [domains];

	const normalized = domains.map(domain => String(domain || '')
		.trim()
		.toLowerCase()
		.replace(/^@+/, '')
		.replace(/\.$/, '')
	);
	if (normalized.some(domain => !verifyUtils.isDomain(domain))) {
		throw new Error('Invalid managed domain configuration.');
	}
	return [...new Set(normalized)];
}

export function managedDomainSuffixes(value) {
	return managedDomains(value).map(domain => `@${domain}`);
}

export function isManagedEmail(email, value) {
	const domain = String(email || '').trim().toLowerCase().split('@')[1] || '';
	return managedDomains(value).includes(domain);
}
