const verifyUtils = {
	isEmail(str) {
		return  /^[a-zA-Z0-9!#$%&'*+/=?^_`{|}~.-]+@([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/.test(str);
	},
	isDomain(str) {
		return /^(?!:\/\/)([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/.test(str);
	}
}

export default  verifyUtils
