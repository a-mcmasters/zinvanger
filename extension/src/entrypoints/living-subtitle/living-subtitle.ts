import FrameBridgeServer from '@/services/frame-bridge-server';
import { fetchLocalization } from '@/services/localization-fetcher';
import { renderLivingSubtitleUi } from '@/ui/living-subtitle';

void (async () => {
    const params = new URLSearchParams(location.search);
    const loc = await fetchLocalization(params.get('lang') ?? document.documentElement.lang);
    document.documentElement.lang = loc.lang;
    const part = params.get('part') === 'card' ? 'card' : 'strip';
    const bridge = renderLivingSubtitleUi(document.getElementById('root')!, loc.lang, loc.strings, part);
    const listener = new FrameBridgeServer(bridge);
    listener.bind({ useRuntimeMessages: true });
    window.addEventListener('unload', () => listener.unbind());
})();
