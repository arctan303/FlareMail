import Dexie from "dexie";
import {useUserStore} from "@/store/user.js"
import { watch, shallowRef } from "vue";
import {createOwnedDraftDatabase, normalizeDraftUserId} from './owned-draft-database.js';

const userStore = useUserStore();


let db =  shallowRef({})

function createDB(userId) {
    db.value?.invalidate?.();
    db.value = createOwnedDraftDatabase(Dexie, userId);
}

watch(() => normalizeDraftUserId(userStore.user.userId), createDB, {immediate: true, flush: 'sync'})

export default db;
