import { defineStore } from 'pinia'

export const useWriterStore = defineStore('writer', {
    state: () => ({
        sendRecipientRecord: []
    }),
    persist: {
        pick: ['sendRecipientRecord'],
    },
})
