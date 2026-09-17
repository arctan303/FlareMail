export async function ensureMigrationTable(c) {
	await c.env.db.prepare(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version INTEGER PRIMARY KEY,
			applied_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`).run();
}

export async function intDB(c) {
	// 初始化数据库表结构
	await c.env.db.prepare(`
	  CREATE TABLE IF NOT EXISTS email (
		email_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
		send_email TEXT,
		name TEXT,
		account_id INTEGER NOT NULL,
		user_id INTEGER NOT NULL,
		subject TEXT,
		content TEXT,
		text TEXT,
		create_time DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
		is_del INTEGER DEFAULT 0 NOT NULL
	  )
	`).run();

	await c.env.db.prepare(`
	  CREATE TABLE IF NOT EXISTS star (
		star_id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		email_id INTEGER NOT NULL,
		create_time DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
	  )
	`).run();

	await c.env.db.prepare(`
	  CREATE TABLE IF NOT EXISTS attachments (
		att_id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		email_id INTEGER NOT NULL,
		account_id INTEGER NOT NULL,
		key TEXT NOT NULL,
		filename TEXT,
		mime_type TEXT,
		size INTEGER,
		disposition TEXT,
		related TEXT,
		content_id TEXT,
		encoding TEXT,
		create_time DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
	  )
	`).run();

	await c.env.db.prepare(`
	  CREATE TABLE IF NOT EXISTS user (
		user_id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT NOT NULL,
		type INTEGER DEFAULT 1 NOT NULL,
		password TEXT NOT NULL,
		salt TEXT NOT NULL,
		status INTEGER DEFAULT 0 NOT NULL,
		is_admin INTEGER DEFAULT 0 NOT NULL CHECK (is_admin IN (0, 1)),
		create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
		active_time DATETIME,
		is_del INTEGER DEFAULT 0 NOT NULL
	  )
	`).run();

	await c.env.db.prepare(`
	  CREATE TABLE IF NOT EXISTS account (
		account_id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT NOT NULL,
		status INTEGER DEFAULT 0 NOT NULL,
		latest_email_time DATETIME,
		create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
		user_id INTEGER NOT NULL,
		is_del INTEGER DEFAULT 0 NOT NULL,
		all_receive INTEGER DEFAULT 0 NOT NULL,
		sort INTEGER DEFAULT 0 NOT NULL,
		is_default_send INTEGER DEFAULT 0 NOT NULL,
		forward_status INTEGER DEFAULT 0 NOT NULL
	  )
	`).run();

	await c.env.db.prepare(`
	  CREATE TABLE IF NOT EXISTS setting (
		register INTEGER NOT NULL,
		receive INTEGER NOT NULL,
		add_email INTEGER NOT NULL,
		many_email INTEGER NOT NULL,
		title TEXT NOT NULL,
		auto_refresh INTEGER NOT NULL,
		register_verify INTEGER NOT NULL,
		add_email_verify INTEGER NOT NULL
	  )
	`).run();

	await c.env.db.prepare(`
	  CREATE TABLE IF NOT EXISTS contact (
		contact_id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		name TEXT NOT NULL,
		email TEXT NOT NULL,
		phone TEXT,
		remark TEXT,
		group_name TEXT,
		create_time DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
		update_time DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
		is_del INTEGER DEFAULT 0 NOT NULL
	  )
	`).run();
	await c.env.db.prepare(`CREATE INDEX IF NOT EXISTS idx_contact_user_id ON contact(user_id, is_del)`).run();
	await c.env.db.prepare(`CREATE INDEX IF NOT EXISTS idx_contact_email ON contact(email)`).run();

	try {
		await c.env.db.prepare(`
		  INSERT INTO setting (
			register, receive, add_email, many_email, title, auto_refresh, register_verify, add_email_verify
		  )
		  SELECT 0, 0, 0, 0, 'FlareMail', 0, 1, 1
		  WHERE NOT EXISTS (SELECT 1 FROM setting)
		`).run();
	} catch (e) {
		console.warn(e);
	}
}
