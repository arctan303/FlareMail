const MESSAGE_ID_PATTERN = /<[^<>\s@\u0000-\u001f\u007f]+@[^<>\s@\u0000-\u001f\u007f]+>/g;

export const conversationLimits = Object.freeze({
	maxSingleFieldChars: 512,
	maxReferencesChars: 2048,
	maxSubjectChars: 512,
	maxIdsPerField: 50,
	maxMessages: 200,
});

const REPLY_PREFIX_PATTERN = /^(?:re(?:\[\d+\])?|回复|回覆|答复)\s*[:：]\s*/iu;

export function normalizeConversationSubject(value, limits = conversationLimits) {
	const raw = String(value || '');
	if (raw.length > limits.maxSubjectChars) return { subject: '', truncated: true };
	let subject = raw.trim();
	let previous;
	do {
		previous = subject;
		subject = subject.replace(REPLY_PREFIX_PATTERN, '').trim();
	} while (subject !== previous);
	return { subject, truncated: false };
}

export function parseConversationIds(value, limits = conversationLimits, maxChars = limits.maxReferencesChars) {
	const raw = String(value || '');
	const limited = raw.slice(0, maxChars);
	const matches = limited.match(MESSAGE_ID_PATTERN) || [];
	return {
		ids: [...new Set(matches.slice(0, limits.maxIdsPerField))],
		truncated: raw.length > maxChars || matches.length > limits.maxIdsPerField,
	};
}

export function groupConversations(rows, limits = conversationLimits) {
	const parent = new Map();
	const rank = new Map();
	const find = id => {
		let root = id;
		while (parent.get(root) !== root) root = parent.get(root);
		let current = id;
		while (parent.get(current) !== current) {
			const next = parent.get(current);
			parent.set(current, root);
			current = next;
		}
		return root;
	};
	const union = (left, right) => {
		const a = find(left); const b = find(right);
		if (a === b) return;
		const rankA = rank.get(a) || 0; const rankB = rank.get(b) || 0;
		if (rankA < rankB) parent.set(a, b);
		else {
			parent.set(b, a);
			if (rankA === rankB) rank.set(a, rankA + 1);
		}
	};
	const messageOwners = new Map();
	const parsedRows = [];
	let truncated = false;
	for (const row of rows) {
		parent.set(row.emailId, row.emailId);
		rank.set(row.emailId, 0);
		const normalizedSubject = normalizeConversationSubject(row.subject, limits);
		const messageIds = parseConversationIds(row.messageId, limits, limits.maxSingleFieldChars);
		const inReplyTo = parseConversationIds(row.inReplyTo, limits, limits.maxSingleFieldChars);
		const references = parseConversationIds(row.relation, limits, limits.maxReferencesChars);
		const fields = [messageIds, inReplyTo, references];
		if (normalizedSubject.truncated || fields.some(field => field.truncated)) truncated = true;
		const parsed = { row, subject: normalizedSubject.subject, subjectTruncated: normalizedSubject.truncated,
			messageIds: messageIds.ids, inReplyTo: inReplyTo.ids, references: references.ids };
		parsedRows.push(parsed);
		for (const token of messageIds.ids) {
			if (!messageOwners.has(token)) messageOwners.set(token, []);
			messageOwners.get(token).push(parsed);
		}
	}
	// Duplicate Message-IDs remain distinct rows, but belong to the same conversation
	// only when their normalized subjects also agree.
	for (const owners of messageOwners.values()) {
		const bySubject = new Map();
		for (const owner of owners) {
			if (owner.subjectTruncated) continue;
			if (bySubject.has(owner.subject)) union(owner.row.emailId, bySubject.get(owner.subject));
			else bySubject.set(owner.subject, owner.row.emailId);
		}
	}
	const parentInfo = new Map();
	for (const [token, owners] of messageOwners) {
		const validOwners = owners.filter(owner => !owner.subjectTruncated);
		const subjects = new Set(validOwners.map(owner => owner.subject));
		parentInfo.set(token, {
			ambiguous: validOwners.length !== owners.length || subjects.size !== 1,
			subject: subjects.size === 1 ? validOwners[0].subject : '',
			representativeEmailId: validOwners[0]?.row.emailId,
		});
	}
	const missingOwner = new Map();
	for (const parsed of parsedRows) {
		if (parsed.subjectTruncated) continue;
		const nearestVisible = tokens => {
			for (let index = tokens.length - 1; index >= 0; index--) {
				const info = parentInfo.get(tokens[index]);
				if (info) return info;
			}
			return null;
		};
		const visibleParent = nearestVisible(parsed.inReplyTo) || nearestVisible(parsed.references);
		if (visibleParent) {
			// A visible nearest parent with a changed subject is a hard boundary. Do not
			// skip over it to an older References ancestor whose subject happens to match.
			// Conflicting or truncated subjects for one duplicate Message-ID are
			// ambiguous, so the token cannot attach a child to any owner. Same-subject
			// copies were already unioned, making one representative sufficient here.
			if (!visibleParent.ambiguous && visibleParent.subject === parsed.subject) {
				union(parsed.row.emailId, visibleParent.representativeEmailId);
			}
			continue;
		}
		const missingToken = parsed.inReplyTo.at(-1) || parsed.references.at(-1);
		if (!missingToken) continue;
		const partitionedToken = `${parsed.subject}\u0000${missingToken}`;
		if (missingOwner.has(partitionedToken)) union(parsed.row.emailId, missingOwner.get(partitionedToken));
		else missingOwner.set(partitionedToken, parsed.row.emailId);
	}
	const groups = new Map();
	for (const row of rows) {
		const root = find(row.emailId);
		if (!groups.has(root)) groups.set(root, []);
		groups.get(root).push(row.emailId);
	}
	return { groups: [...groups.values()], truncated };
}

export function findConversation(rows, anchorEmailId, limits = conversationLimits) {
	const grouped = groupConversations(rows, limits);
	const related = grouped.groups.find(group => group.includes(anchorEmailId)) || [];
	let truncated = grouped.truncated;
	if (related.length > limits.maxMessages) truncated = true;
	return { emailIds: related.slice(0, limits.maxMessages), truncated };
}
