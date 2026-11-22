import { installAggressiveGenericPageDiscovery } from '@/pages/aggressive-generic-page';
import { videolandSubtitleUrlKey } from '@/pages/videoland';

export default defineUnlistedScript(() => {
    installAggressiveGenericPageDiscovery(document, videolandSubtitleUrlKey);
});
