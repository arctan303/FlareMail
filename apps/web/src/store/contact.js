import { defineStore } from 'pinia';
import { contactList, contactGroups, contactAdd, contactUpdate, contactDelete } from '@/request/contact.js';

// Sentinel id for the "no group" filter. It used to be the Chinese label itself,
// which broke the filter as soon as the interface language changed.
export const UNGROUPED_GROUP = '__ungrouped__';

export const useContactStore = defineStore('contact', {
    state: () => ({
        contacts: [],
        groups: [],
        activeContactId: null,
        searchKeyword: '',
        selectedGroup: 'ALL',
        loading: false,
    }),
    getters: {
        activeContact: (state) => {
            if (!state.activeContactId && state.contacts.length > 0) {
                return state.contacts[0];
            }
            return state.contacts.find(c => c.contactId === state.activeContactId) || null;
        },
        filteredContacts: (state) => {
            return state.contacts.filter(c => {
                // Group match
                if (state.selectedGroup !== 'ALL') {
                    if (state.selectedGroup === UNGROUPED_GROUP) {
                        if (c.groupName && c.groupName.trim() !== '') return false;
                    } else if (c.groupName !== state.selectedGroup) {
                        return false;
                    }
                }
                // Keyword match
                if (state.searchKeyword && state.searchKeyword.trim() !== '') {
                    const kw = state.searchKeyword.trim().toLowerCase();
                    const nameMatch = (c.name || '').toLowerCase().includes(kw);
                    const emailMatch = (c.email || '').toLowerCase().includes(kw);
                    const remarkMatch = (c.remark || '').toLowerCase().includes(kw);
                    const phoneMatch = (c.phone || '').toLowerCase().includes(kw);
                    return nameMatch || emailMatch || remarkMatch || phoneMatch;
                }
                return true;
            });
        }
    },
    actions: {
        async fetchContacts(params = {}) {
            this.loading = true;
            try {
                const res = await contactList(params);
                // Axios interceptor extracts data.data -> res is { list: [...], total: ... } or [...]
                let list = [];
                if (Array.isArray(res)) {
                    list = res;
                } else if (res?.list && Array.isArray(res.list)) {
                    list = res.list;
                } else if (res?.data?.list && Array.isArray(res.data.list)) {
                    list = res.data.list;
                }
                this.contacts = list;
                if (!this.activeContactId && this.contacts.length > 0) {
                    this.activeContactId = this.contacts[0].contactId;
                } else if (this.activeContactId && !this.contacts.some(c => c.contactId === this.activeContactId)) {
                    this.activeContactId = this.contacts[0]?.contactId || null;
                }
            } catch (e) {
                console.error('Failed to fetch contacts:', e);
            } finally {
                this.loading = false;
            }
        },

        async fetchGroups() {
            try {
                const res = await contactGroups();
                let grps = [];
                if (Array.isArray(res)) {
                    grps = res;
                } else if (Array.isArray(res?.data)) {
                    grps = res.data;
                }
                this.groups = grps;
            } catch (e) {
                console.warn('Failed to fetch contact groups:', e);
            }
        },

        async createContact(data) {
            const res = await contactAdd(data);
            await this.fetchContacts();
            await this.fetchGroups();
            const contactId = res?.contactId || res?.data?.contactId;
            if (contactId) {
                this.activeContactId = contactId;
            }
            return res;
        },

        async editContact(data) {
            const res = await contactUpdate(data);
            await this.fetchContacts();
            await this.fetchGroups();
            return res;
        },

        async removeContact(contactId) {
            await contactDelete({ contactId });
            await this.fetchContacts();
            await this.fetchGroups();
            if (this.activeContactId === contactId) {
                this.activeContactId = this.contacts[0]?.contactId || null;
            }
        }
    }
});
