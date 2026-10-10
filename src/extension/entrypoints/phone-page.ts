import { installPhoneApi } from '@/lib/phone/page-api';

export default defineUnlistedScript({ exclude: ['firefox'], main: () => installPhoneApi() });
