import { createRoot } from 'react-dom/client';
import { PopupUi } from '../components/PopupUi';
import type { AsbplayerSettings } from '@project/common/settings';

export interface PopupUiParameters {
    currentSettings: AsbplayerSettings;
    commands: any;
}

export async function renderPopupUi(element: Element, { currentSettings, commands }: PopupUiParameters) {
    createRoot(element).render(<PopupUi initialSettings={currentSettings} commands={commands} />);
}
