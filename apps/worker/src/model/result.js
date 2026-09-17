const result = {
	ok(data) {
		return { code: 200, message: 'success', data: data ? data : null };
	},
	fail(message, code = 500) {
		return { code, message };
	}
};
export default result;
