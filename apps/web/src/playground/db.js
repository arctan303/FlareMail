import {shallowRef} from 'vue';
import {initialPreviewLocale} from './locale.js';
import {createMemoryDb} from './memory-db.js';
const memory = createMemoryDb(initialPreviewLocale(location.pathname,navigator));
const db = shallowRef(memory);
export default db;
