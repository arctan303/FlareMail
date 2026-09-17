import axios from 'axios';
import {ElMessage} from 'element-plus';
import {createPlaygroundApi} from './api.js';
import {initialPreviewLocale} from './locale.js';
import {useSettingStore} from '@/store/setting.js';

export const playground = createPlaygroundApi(initialPreviewLocale(location.pathname,navigator));
const http = axios.create({
    adapter: async config => {
        playground.setLocale(useSettingStore().lang || 'zh');
        await new Promise(resolve => setTimeout(resolve, 90));
        try {
            const data = await playground.handle(config.method || 'get', config.url, config.data, config.params);
            config.onUploadProgress?.({loaded:1,total:1});
            return {data:{code:200,data},status:200,statusText:'OK',headers:{},config};
        } catch(error) {
            if(!config.noMsg) ElMessage({message:error.message,type:'warning',plain:true});
            throw error;
        }
    },
});
http.interceptors.response.use(response => response.data.data);
export default http;
