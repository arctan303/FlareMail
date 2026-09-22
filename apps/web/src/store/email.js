import { defineStore } from 'pinia'

export const useEmailStore = defineStore('email', {
    state: () => ({
        deleteIds: 0,
        starScroll: null,
        emailScroll: null,
        cancelStarEmailId: 0,
        addStarEmailId: 0,
        searchKeyword: '',
        conversationRevision: 0,
        contentData: {
            email: null,
            delType: null,
            showStar: true,
            showReply: true,
            showUnread: false
        },
        sendScroll: null,
    }),
    actions: {
        setSearchKeyword(keyword) {
            this.searchKeyword = keyword || ''
        },
        clearSearch() {
            this.searchKeyword = ''
        }
    },
    persist: {
        pick: ['contentData'],
    },
})
