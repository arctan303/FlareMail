import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { dbInit } from '../src/init/init';
import emailService from '../src/service/email-service';
import cryptoUtils from '../src/utils/crypto-utils';
import { conversationLimits, findConversation, groupConversations, normalizeConversationSubject, parseConversationIds } from '../src/utils/mail-conversation';
import { markInstalled } from './installed-instance';
import worker from '../src';

const context = () => { const values = new Map(); return { env, get: key => values.get(key), set: (key, value) => values.set(key, value) }; };
async function mailbox(address, admin = 0) {
	const password = await cryptoUtils.hashPassword(`conversation-${address}`);
	const user = await env.db.prepare('INSERT INTO user(email,password,salt,is_admin) VALUES (?,?,?,?) RETURNING user_id AS id')
		.bind(address, password.hash, password.salt, admin).first();
	const account = await env.db.prepare('INSERT INTO account(email,user_id) VALUES (?,?) RETURNING account_id AS id')
		.bind(address, user.id).first();
	return { userId: user.id, accountId: account.id };
}

describe.sequential('bounded mail conversations', () => {
	let owner; let outsider; let secondAccountId; let deletedAccountId; const ids = {};
	beforeAll(async () => {
		await dbInit.migrate(context());
		await markInstalled(env, ['example.com'], []);
		owner = await mailbox('conversation-owner@example.com', 1);
		outsider = await mailbox('conversation-outsider@example.com');
		secondAccountId = (await env.db.prepare('INSERT INTO account(email,user_id) VALUES (?,?) RETURNING account_id AS id')
			.bind('conversation-owner-2@example.com', owner.userId).first()).id;
		const deleted = await env.db.prepare('INSERT INTO account(email,user_id,is_del) VALUES (?,?,1) RETURNING account_id AS id')
			.bind('conversation-deleted@example.com', owner.userId).first();
		deletedAccountId = deleted.id;
		async function add(key, { messageId = '', inReplyTo = '', relation = '', subject = key, accountId = owner.accountId, userId = owner.userId, type = 0, isDel = 0 } = {}) {
			const row = await env.db.prepare(`INSERT INTO email(user_id,account_id,type,status,subject,text,message_id,in_reply_to,relation,is_del,create_time)
				VALUES (?,?,?,0,?,?,?,?,?,?,datetime('2026-01-01','+' || ? || ' minutes')) RETURNING email_id AS id`)
				.bind(userId, accountId, type, subject, key, messageId, inReplyTo, relation, isDel, Object.keys(ids).length + 1).first();
			ids[key] = row.id; return row.id;
		}
		await add('root', { messageId: '<root@thread.test>', subject: 'Topic' });
		await add('reply', { messageId: '<reply@thread.test>', inReplyTo: '<root@thread.test>', relation: '<root@thread.test>', subject: ' re: Topic ' });
		await add('branch', { messageId: '<branch@thread.test>', inReplyTo: '<root@thread.test>', relation: '<root@thread.test>', subject: '回复：Topic' });
		await add('third', { messageId: '<third@thread.test>', inReplyTo: '<reply@thread.test>', relation: '<root@thread.test> <reply@thread.test>', subject: 'RE[2]: 回覆: Topic' });
		await add('sentSecondMailbox', { messageId: '<sent@thread.test>', inReplyTo: '<third@thread.test>', relation: '', subject: '答复：Topic', accountId: secondAccountId, type: 1 });
		await add('duplicate', { messageId: '<reply@thread.test>', subject: 'Topic' });
		await add('sameSubject', { messageId: '<unrelated@thread.test>', subject: 'Topic' });
		await add('noId', { subject: 'first subject' });
		await add('orphanA', { messageId: '<orphan-a@thread.test>', relation: '<missing@thread.test>', subject: 'Orphan' });
		await add('orphanB', { messageId: '<orphan-b@thread.test>', relation: '<missing@thread.test>', subject: 'Re: Orphan' });
		await add('foreign', { messageId: '<root@thread.test>', userId: outsider.userId, accountId: outsider.accountId });
		await add('unrelatedBridgeTarget', { messageId: '<bridge-target@thread.test>' });
		await add('foreignBridge', { messageId: '<foreign-bridge@thread.test>', relation: '<root@thread.test> <bridge-target@thread.test>', userId: outsider.userId, accountId: outsider.accountId });
		await add('deletedAccount', { messageId: '<deleted@thread.test>', inReplyTo: '<root@thread.test>', subject: 'Topic', accountId: deletedAccountId });
		await add('deletedRow', { messageId: '<deleted-row@thread.test>', inReplyTo: '<root@thread.test>', subject: 'Topic', isDel: 1 });
		await add('wrongAccountOwner', { messageId: '<wrong-owner@thread.test>', userId: owner.userId, accountId: outsider.accountId });
		await add('changedRoot', { messageId: '<changed-a@thread.test>', subject: 'Alpha' });
		await add('changedMiddle', { messageId: '<changed-b@thread.test>', inReplyTo: '<changed-a@thread.test>', relation: '<changed-a@thread.test>', subject: 'Beta' });
		await add('changedReturn', { messageId: '<changed-c@thread.test>', inReplyTo: '<changed-b@thread.test>', relation: '<changed-a@thread.test> <changed-b@thread.test>', subject: 'Re: Alpha' });
		await add('changedFollow', { messageId: '<changed-d@thread.test>', inReplyTo: '<changed-c@thread.test>', relation: '<changed-a@thread.test> <changed-b@thread.test> <changed-c@thread.test>', subject: '回复：RE[4]: Alpha' });
		await add('referencesRoot', { messageId: '<refs-root@thread.test>', subject: 'References only' });
		await add('referencesChild', { messageId: '<refs-child@thread.test>', relation: '<refs-root@thread.test>', subject: 'Re: References only' });
	});

	it('uses exact IDs and normalized subjects for generations, branches, duplicates and orphans', async () => {
		const page = await emailService.conversation(context(), { emailId: ids.root, size: 20 }, owner.userId);
		expect(page.messages.map(row => row.emailId)).toEqual([ids.root, ids.reply, ids.branch, ids.third, ids.sentSecondMailbox, ids.duplicate]);
		expect(page.messages.map(row => row.emailId)).not.toContain(ids.sameSubject);
		expect(page.messages.map(row => row.emailId)).not.toContain(ids.deletedAccount);
		expect(page.messages.map(row => row.emailId)).not.toContain(ids.deletedRow);
		expect(page.messages.map(row => row.emailId)).not.toContain(ids.unrelatedBridgeTarget);
		expect(page.messages.every(row => row.userId === owner.userId)).toBe(true);
		expect(page.scanLimited).toBe(false);

		const orphan = await emailService.conversation(context(), { emailId: ids.orphanA, size: 20 }, owner.userId);
		expect(orphan.messages.map(row => row.emailId)).toEqual([ids.orphanA, ids.orphanB]);
		const singleton = await emailService.conversation(context(), { emailId: ids.noId, size: 20 }, owner.userId);
		expect(singleton.messages.map(row => row.emailId)).toEqual([ids.noId]);
		await expect(emailService.conversation(context(), { emailId: ids.root, size: 20 }, outsider.userId)).rejects.toMatchObject({ code: 404 });
		await expect(emailService.conversation(context(), { emailId: ids.wrongAccountOwner, size: 20 }, owner.userId)).rejects.toMatchObject({ code: 404 });
	});

	it('uses the nearest visible parent as a hard subject boundary and supports References-only replies', async () => {
		const first = await emailService.conversation(context(), { emailId: ids.changedRoot, size: 20 }, owner.userId);
		const middle = await emailService.conversation(context(), { emailId: ids.changedMiddle, size: 20 }, owner.userId);
		const returned = await emailService.conversation(context(), { emailId: ids.changedReturn, size: 20 }, owner.userId);
		expect(first.messages.map(row => row.emailId)).toEqual([ids.changedRoot]);
		expect(middle.messages.map(row => row.emailId)).toEqual([ids.changedMiddle]);
		expect(returned.messages.map(row => row.emailId)).toEqual([ids.changedReturn,ids.changedFollow]);
		const referencesOnly = await emailService.conversation(context(), { emailId: ids.referencesRoot, size: 20 }, owner.userId);
		expect(referencesOnly.messages.map(row => row.emailId)).toEqual([ids.referencesRoot,ids.referencesChild]);
	});

	it('keeps a real empty-subject reply chain together across list, read and delete without rewriting subjects', async () => {
		const emptyRoot = await env.db.prepare(`INSERT INTO email(user_id,account_id,type,status,subject,message_id,unread)
			VALUES (?,?,0,0,'','<empty-root@thread.test>',0) RETURNING email_id AS id`).bind(owner.userId,owner.accountId).first();
		const emptyReply = await env.db.prepare(`INSERT INTO email(user_id,account_id,type,status,subject,message_id,in_reply_to,relation,unread)
			VALUES (?,?,0,0,'Re:','<empty-reply@thread.test>','<empty-root@thread.test>','<empty-root@thread.test>',0) RETURNING email_id AS id`).bind(owner.userId,owner.accountId).first();
		const emptyGrandchild = await env.db.prepare(`INSERT INTO email(user_id,account_id,type,status,subject,message_id,in_reply_to,relation,unread)
			VALUES (?,?,0,0,' Re: Re： ','<empty-grandchild@thread.test>','<empty-reply@thread.test>','<empty-root@thread.test> <empty-reply@thread.test>',0) RETURNING email_id AS id`).bind(owner.userId,owner.accountId).first();
		const independent = await env.db.prepare(`INSERT INTO email(user_id,account_id,type,status,subject,message_id,unread)
			VALUES (?,?,0,0,'','<empty-independent@thread.test>',0) RETURNING email_id AS id`).bind(owner.userId,owner.accountId).first();

		const opened = await emailService.conversation(context(),{emailId:emptyRoot.id,size:20},owner.userId);
		expect(opened.messages.map(row=>row.emailId)).toEqual([emptyRoot.id,emptyReply.id,emptyGrandchild.id]);
		expect(opened.messages.map(row=>row.subject)).toEqual(['','Re:',' Re: Re： ']);
		expect(opened.messages.map(row=>row.emailId)).not.toContain(independent.id);
		const listed = await emailService.list(context(),{view:'conversation',accountId:owner.accountId,allReceive:0,type:0,size:100,offset:0,filter:'all'},owner.userId);
		const summary=listed.list.find(row=>row.memberIds.includes(emptyRoot.id));
		expect(summary.memberIds.sort((a,b)=>a-b)).toEqual([emptyRoot.id,emptyReply.id,emptyGrandchild.id].sort((a,b)=>a-b));

		const boundary=Math.max(emptyRoot.id,emptyReply.id,emptyGrandchild.id,independent.id);
		const read=await emailService.readConversation(context(),emptyRoot.id,boundary,owner.userId);
		expect(read.emailIds.sort((a,b)=>a-b)).toEqual([emptyRoot.id,emptyReply.id,emptyGrandchild.id].sort((a,b)=>a-b));
		expect((await env.db.prepare('SELECT unread FROM email WHERE email_id=?').bind(independent.id).first()).unread).toBe(0);
		const deleted=await emailService.conversationState(context(),{emailIds:[emptyRoot.id],view:{type:0,accountId:owner.accountId,allReceive:0},action:'delete'},owner.userId);
		expect(deleted.emailIds.sort((a,b)=>a-b)).toEqual([emptyRoot.id,emptyReply.id,emptyGrandchild.id].sort((a,b)=>a-b));
		const stored=await env.db.prepare('SELECT subject,is_del AS isDel FROM email WHERE email_id IN (?,?,?,?) ORDER BY email_id').bind(emptyRoot.id,emptyReply.id,emptyGrandchild.id,independent.id).all();
		expect(stored.results.map(row=>row.subject)).toEqual(['','Re:',' Re: Re： ','']);
		expect(stored.results.map(row=>row.isDel)).toEqual([1,1,1,0]);
	});

	it('paginates newest-first with an opaque tuple cursor and returns each page in ascending time', async () => {
		const first = await emailService.conversation(context(), { emailId: ids.root, size: 2 }, owner.userId);
		expect(first.hasMore).toBe(true);
		expect(first.nextCursor).toEqual(expect.any(String));
		expect(first.messages.map(row => row.emailId)).toEqual([ids.sentSecondMailbox, ids.duplicate]);
		const second = await emailService.conversation(context(), { emailId: ids.root, size: 2, before: first.nextCursor }, owner.userId);
		expect(second.messages.map(row => row.emailId)).toEqual([ids.branch, ids.third]);
		const third = await emailService.conversation(context(), { emailId: ids.root, size: 2, before: second.nextCursor }, owner.userId);
		expect(third.messages.map(row => row.emailId)).toEqual([ids.root, ids.reply]);
		expect(third.hasMore).toBe(false);
	});

	it('exposes the bounded conversation through the authenticated API', async () => {
		const loginContext = createExecutionContext();
		const login = await worker.fetch(new Request('http://localhost/api/login', {
			method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
			body: JSON.stringify({ email: 'conversation-owner@example.com', password: 'conversation-conversation-owner@example.com' }),
		}), env, loginContext);
		await waitOnExecutionContext(loginContext);
		expect(login.status).toBe(200);
		const cookie = login.headers.get('set-cookie').split(';')[0];
		const requestContext = createExecutionContext();
		const response = await worker.fetch(new Request(`http://localhost/api/email/conversation?emailId=${ids.root}&size=2`, {
			headers: { Cookie: cookie, Origin: 'http://localhost' },
		}), env, requestContext);
		await waitOnExecutionContext(requestContext);
		expect(response.status).toBe(200);
		const data = (await response.json()).data;
		expect(data).toMatchObject({ anchorEmailId: ids.root, hasMore: true, scanLimited: false });
		expect(data.messages).toHaveLength(2);
	});

	it('groups before list pagination and applies scoped state plus a read watermark', async () => {
		const listed = await emailService.list(context(), { view:'conversation', accountId:owner.accountId, allReceive:1, type:0, size:20, offset:0, filter:'all' }, owner.userId);
		const thread = listed.list.find(row => row.memberIds.includes(ids.root));
		expect(thread.conversationId).toBe(Math.min(ids.root,ids.reply,ids.branch,ids.third,ids.sentSecondMailbox,ids.duplicate));
		expect(thread.conversationCount).toBe(6);
		expect(thread.scopeCount).toBe(5);
		expect(thread.memberIds).not.toContain(ids.sentSecondMailbox);

		const state = await emailService.conversationState(context(), { emailIds:[ids.root], view:{type:0,accountId:owner.accountId,allReceive:1}, action:'unread' }, owner.userId);
		expect(state.emailIds).toHaveLength(5);
		const boundary = Math.max(...(await emailService.loadConversationMetadata(context(),owner.userId)).map(row=>row.emailId));
		const late = await env.db.prepare(`INSERT INTO email(user_id,account_id,type,status,subject,message_id,in_reply_to,relation,unread)
			VALUES (?,?,0,0,'Re: Topic','<late@thread.test>','<third@thread.test>','<root@thread.test> <third@thread.test>',0) RETURNING email_id AS id`)
			.bind(owner.userId,owner.accountId).first();
		const read = await emailService.readConversation(context(),ids.root,boundary,owner.userId);
		expect(read.emailIds).not.toContain(late.id);
		expect((await env.db.prepare('SELECT unread FROM email WHERE email_id=?').bind(late.id).first()).unread).toBe(0);
		expect((await env.db.prepare('SELECT unread FROM email WHERE email_id=?').bind(ids.root).first()).unread).toBe(1);
		await expect(emailService.conversationState(context(), {emailIds:[ids.root],view:{type:0,accountId:owner.accountId,allReceive:1},action:'read'}, outsider.userId)).rejects.toMatchObject({code:404});
		await expect(emailService.conversationState(context(), {emailIds:[ids.root],view:{type:0,accountId:outsider.accountId,allReceive:0},action:'read'}, owner.userId)).rejects.toMatchObject({code:404});
		const ascending=await emailService.list(context(),{view:'conversation',accountId:owner.accountId,allReceive:1,type:0,size:50,offset:0,filter:'all',timeSort:1},owner.userId);
		expect(ascending.list[0].emailId).not.toBe(listed.list[0].emailId);
	});

	it('keeps starred scope narrow, preserves alias search, and chunks mutations above 100 IDs', async () => {
		await env.db.prepare('INSERT OR IGNORE INTO star(user_id,email_id) VALUES (?,?)').bind(owner.userId,ids.root).run();
		const unstar=await emailService.conversationState(context(),{emailIds:[ids.root],view:{starred:true},action:'unstar'},owner.userId);
		expect(unstar.emailIds).toEqual([ids.root]);
		const alias=await env.db.prepare(`INSERT INTO email(user_id,account_id,type,status,subject,send_email,message_id)
			VALUES (?,?,0,0,'alias searchable','person@example.com','<alias@thread.test>') RETURNING email_id AS id`).bind(owner.userId,owner.accountId).first();
		const searched=await emailService.list(context(),{view:'conversation',accountId:owner.accountId,allReceive:1,type:0,size:20,offset:0,filter:'all',keyword:'person+tag@example.com'},owner.userId);
		expect(searched.list.some(row=>row.memberIds.includes(alias.id))).toBe(true);
		let parent='<root@thread.test>';
		for(let index=0;index<120;index++){
			const messageId=`<bulk-${index}@thread.test>`;
			await env.db.prepare(`INSERT INTO email(user_id,account_id,type,status,subject,message_id,in_reply_to,unread) VALUES (?,?,0,0,'Re: Topic',?,?,1)`)
				.bind(owner.userId,owner.accountId,messageId,parent).run(); parent=messageId;
		}
		const changed=await emailService.conversationState(context(),{emailIds:[ids.root],view:{type:0,accountId:owner.accountId,allReceive:1},action:'unread'},owner.userId);
		expect(changed.updatedCount).toBeGreaterThan(100);
	});

	it('limits starred state changes to the selected mailbox and validates emailIds', async () => {
		const first = await env.db.prepare(`INSERT INTO email(user_id,account_id,type,status,subject,message_id)
			VALUES (?,?,0,0,'starred account A','<starred-scope-a@thread.test>') RETURNING email_id AS id`)
			.bind(owner.userId,owner.accountId).first();
		const second = await env.db.prepare(`INSERT INTO email(user_id,account_id,type,status,subject,message_id,in_reply_to)
			VALUES (?,?,0,0,'Re: starred account A','<starred-scope-b@thread.test>','<starred-scope-a@thread.test>') RETURNING email_id AS id`)
			.bind(owner.userId,secondAccountId).first();
		await env.db.batch([
			env.db.prepare('INSERT INTO star(user_id,email_id) VALUES (?,?)').bind(owner.userId,first.id),
			env.db.prepare('INSERT INTO star(user_id,email_id) VALUES (?,?)').bind(owner.userId,second.id),
		]);

		const unstarred = await emailService.conversationState(context(), {
			emailIds:[first.id], view:{starred:true,accountId:owner.accountId}, action:'unstar',
		}, owner.userId);
		expect(unstarred.emailIds).toEqual([first.id]);
		expect(await env.db.prepare('SELECT star_id FROM star WHERE user_id=? AND email_id=?').bind(owner.userId,second.id).first()).toBeTruthy();

		await env.db.prepare('INSERT INTO star(user_id,email_id) VALUES (?,?)').bind(owner.userId,first.id).run();
		const deleted = await emailService.conversationState(context(), {
			emailIds:[first.id], view:{starred:true,accountId:owner.accountId}, action:'delete',
		}, owner.userId);
		expect(deleted.emailIds).toEqual([first.id]);
		expect((await env.db.prepare('SELECT is_del AS isDel FROM email WHERE email_id=?').bind(first.id).first()).isDel).toBe(1);
		expect((await env.db.prepare('SELECT is_del AS isDel FROM email WHERE email_id=?').bind(second.id).first()).isDel).toBe(0);

		await expect(emailService.conversationState(context(), { emailIds:'not-an-array', view:{starred:true}, action:'unstar' }, owner.userId))
			.rejects.toMatchObject({code:400});
	});

	it('marks malformed oversized metadata and caps the component without losing duplicate rows', () => {
		expect(normalizeConversationSubject('  RE[2]： 回复: 回覆：答复: Topic  ')).toEqual({subject:'Topic',truncated:false});
		expect(normalizeConversationSubject(' Fwd: Topic ')).toEqual({subject:'Fwd: Topic',truncated:false});
		expect(normalizeConversationSubject(' Re: ')).toEqual({subject:'',truncated:false});
		expect(parseConversationIds('<id@@host.test> <id\u0000@host.test> <ok@host.test>').ids).toEqual(['<ok@host.test>']);
		const parsed = parseConversationIds(`${'<a@b.test> '.repeat(51)}${'x'.repeat(3000)}`);
		expect(parsed.truncated).toBe(true);
		expect(parseConversationIds('<bad@@thread.test> <good@thread.test>').ids).toEqual(['<good@thread.test>']);
		const rows = Array.from({ length: 205 }, (_, index) => ({ emailId: index + 1, messageId: `<${index}@cap.test>`, inReplyTo: index ? `<${index - 1}@cap.test>` : '', relation: '' }));
		const result = findConversation(rows, 1);
		expect(result.emailIds).toHaveLength(200);
		expect(result.truncated).toBe(true);
	});

	it('is input-order independent and never groups matching truncated subject prefixes', () => {
		const shuffled = [
			{emailId:3,messageId:'<child@order.test>',inReplyTo:'<parent@order.test>',relation:'',subject:'Re: Topic'},
			{emailId:2,messageId:'<changed@order.test>',inReplyTo:'<parent@order.test>',relation:'',subject:'Changed'},
			{emailId:1,messageId:'<parent@order.test>',inReplyTo:'',relation:'',subject:'Topic'},
		];
		expect(findConversation(shuffled,1).emailIds.sort((a,b)=>a-b)).toEqual([1,3]);
		expect(findConversation(shuffled,2).emailIds).toEqual([2]);
		const longPrefix='x'.repeat(512);
		const oversized = groupConversations([
			{emailId:10,messageId:'<long-a@subject.test>',inReplyTo:'<missing@subject.test>',relation:'',subject:`${longPrefix}a`},
			{emailId:11,messageId:'<long-b@subject.test>',inReplyTo:'<missing@subject.test>',relation:'',subject:`${longPrefix}b`},
		]);
		expect(oversized.truncated).toBe(true);
		expect(oversized.groups).toHaveLength(2);
		const ambiguous = [
			{emailId:20,messageId:'<duplicate@ambiguous.test>',inReplyTo:'',relation:'',subject:'Topic'},
			{emailId:21,messageId:'<duplicate@ambiguous.test>',inReplyTo:'',relation:'',subject:'Forged change'},
			{emailId:22,messageId:'<child@ambiguous.test>',inReplyTo:'<duplicate@ambiguous.test>',relation:'',subject:'Re: Topic'},
		];
		expect(findConversation(ambiguous,22).emailIds).toEqual([22]);
		const truncatedParentBoundary = [
			{emailId:30,messageId:'<old@long-boundary.test>',inReplyTo:'',relation:'',subject:'Topic'},
			{emailId:31,messageId:'<long@long-boundary.test>',inReplyTo:'<old@long-boundary.test>',relation:'',subject:`${'x'.repeat(513)}`},
			{emailId:32,messageId:'<new@long-boundary.test>',inReplyTo:'',relation:'<old@long-boundary.test> <long@long-boundary.test>',subject:'Re: Topic'},
		];
		expect(findConversation(truncatedParentBoundary,32).emailIds).toEqual([32]);
		const mixedTruncatedDuplicate = [
			{emailId:40,messageId:'<mixed@long-boundary.test>',inReplyTo:'',relation:'',subject:'Topic'},
			{emailId:41,messageId:'<mixed@long-boundary.test>',inReplyTo:'',relation:'',subject:'x'.repeat(513)},
			{emailId:42,messageId:'<mixed-child@long-boundary.test>',inReplyTo:'<mixed@long-boundary.test>',relation:'',subject:'Re: Topic'},
		];
		expect(findConversation(mixedTruncatedDuplicate,42).emailIds).toEqual([42]);
		expect(findConversation(mixedTruncatedDuplicate,40).emailIds).toEqual([40]);
	});

	it('handles many duplicate owners and references in linear-sized work', () => {
		const duplicateCount=2500;
		const rows=[
			...Array.from({length:duplicateCount},(_,index)=>({emailId:index+1,messageId:'<shared@copies.test>',inReplyTo:'',relation:'',subject:'Topic'})),
			...Array.from({length:duplicateCount},(_,index)=>({emailId:duplicateCount+index+1,messageId:`<child-${index}@copies.test>`,inReplyTo:'<shared@copies.test>',relation:'',subject:'Re: Topic'})),
		];
		const grouped=groupConversations(rows,{...conversationLimits,maxMessages:rows.length});
		expect(grouped.groups).toHaveLength(1);
		expect(grouped.groups[0]).toHaveLength(rows.length);
	},1000);

	it('handles a fully connected 5000-row chain without recursive stack growth', () => {
		const rows = Array.from({ length: 5000 }, (_, index) => ({
			emailId: index + 1,
			messageId: `<node-${index}@deep.test>`,
			inReplyTo: index ? `<node-${index - 1}@deep.test>` : '',
			relation: '',
		}));
		const result = findConversation(rows, 5000, { ...conversationLimits, maxMessages: 5000 });
		expect(result.emailIds).toHaveLength(5000);
		expect(result.truncated).toBe(false);
	});
});
