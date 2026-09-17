    import { defineStore } from 'pinia'

export const useAccountStore = defineStore('account', {
    state: () => ({
        currentAccountId: 0,
        mailboxFilterId: 0,
        currentAccount: {},
        changeUserAccountName: '',
        accountList: []
    }),
    getters: {
        mailboxQuery: state => ({accountId: state.mailboxFilterId || state.currentAccountId, allReceive: state.mailboxFilterId ? 0 : 1}),
    },
})