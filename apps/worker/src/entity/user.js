import { sqliteTable, text, integer} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
const user = sqliteTable('user', {
	userId: integer('user_id').primaryKey({ autoIncrement: true }),
	email: text('email').notNull(),
	type: integer('type').default(1).notNull(),
	password: text('password').notNull(),
	salt: text('salt').notNull(),
	status: integer('status').default(0).notNull(),
	isAdmin: integer('is_admin').default(0).notNull(),
	createTime: text('create_time').default(sql`CURRENT_TIMESTAMP`),
	activeTime: text('active_time'),
	createIp: text('create_ip'),
	activeIp: text('active_ip'),
	os: text('os'),
	browser: text('browser'),
	device: text('device'),
	sort: text('sort').default(0),
	sendCount: integer('send_count').default(0).notNull(),
	forwardStatus: integer('forward_status').default(1).notNull(),
	forwardEmail: text('forward_email').default('').notNull(),
	regKeyId: integer('reg_key_id').default(0).notNull(),
	isDel: integer('is_del').default(0).notNull(),
	sendLimit: integer('send_limit').default(50).notNull(),
	accountLimit: integer('account_limit').default(10).notNull(),
	cliToken: text('cli_token').default(''),
	mainForwardStatus: integer('main_forward_status').default(0).notNull(),
	googleSub: text('google_sub').default(''),
	googleEmail: text('google_email').default('')
});
export default user
