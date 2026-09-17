import { drizzle } from 'drizzle-orm/d1';

const queryOnlyLogger = {
	logQuery(query) {
		console.log(`Query: ${query}`);
	},
};

export default function orm(c) {
	const logger = c.env.ORM_LOG === true || c.env.ORM_LOG === 'true'
		? queryOnlyLogger
		: false;
	return drizzle(c.env.db, { logger })
}
