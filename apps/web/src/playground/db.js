import {shallowRef} from 'vue';
import {initialPreviewLocale} from './locale.js';
import {createMemoryDb} from './memory-db.js';
const memory = createMemoryDb(initialPreviewLocale(location.pathname,navigator));
const db = shallowRef(memory);
// Compose currently calls db.draft; the drafts page calls db.value.draft.
Object.assign(db,memory);
export default db;
