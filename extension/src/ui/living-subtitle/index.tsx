import { createRoot } from 'react-dom/client';
import Bridge from '../bridge';
import LivingSubtitleUi from '../components/LivingSubtitleUi';
import type { LivingSubtitlePart } from '../components/LivingSubtitleUi';
import { i18nInit } from '../i18n';

export function renderLivingSubtitleUi(element: Element, lang: string, locStrings: any, part: LivingSubtitlePart) {
    const bridge = new Bridge();
    i18nInit(lang, locStrings);
    createRoot(element).render(<LivingSubtitleUi bridge={bridge} part={part} />);
    return bridge;
}
