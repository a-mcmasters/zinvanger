import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from '@jest/globals';
import { ThemeProvider } from '@mui/material/styles';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import type { CardModel } from '@project/common';
import { Anki } from '@project/common/anki';
import AnkiDialog from '@project/common/components/AnkiDialog';
import en from '@project/common/locales/en.json';
import { defaultSettings } from '@project/common/settings';
import { createTheme } from '@project/common/theme';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('warns that a previewed picture needs an Anki field before it can be exported', async () => {
    const card: CardModel = {
        subtitle: { text: 'Ik zie een foto.', start: 0, end: 1000, originalStart: 0, originalEnd: 1000, track: 0 },
        subtitleFileName: 'episode.srt',
        surroundingSubtitles: [],
        image: {
            base64: 'UklGRjYAAABXRUJQVlA4ICoAAACQAQCdASoBAAEAAUAmJaACdLoAA5gA/u3O3+HKn07O7/5Bjt57ed2AAAA=',
            extension: 'webp',
        },
        mediaTimestamp: 0,
    };
    const i18n = createInstance();
    await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const anki = new Anki(defaultSettings, {
        fetch: async (_url, { action }) => ({ result: action === 'version' ? 6 : [], error: null }),
    });
    const render = (imageField: string) =>
        act(async () =>
            root.render(
                <I18nextProvider i18n={i18n}>
                    <ThemeProvider theme={createTheme('dark')}>
                        <AnkiDialog
                            open
                            disabled={false}
                            card={card}
                            onProceed={async () => {}}
                            onCancel={() => {}}
                            onCopyToClipboard={() => {}}
                            mp3Encoder={async (blob) => blob}
                            settings={{ ...defaultSettings, imageField }}
                            anki={anki}
                        />
                    </ThemeProvider>
                </I18nextProvider>
            )
        );

    try {
        await render('');
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
            'Choose an Image Field in Anki settings to save this picture.'
        );
        await render('Picture');
        expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(
            'Choose an Image Field in Anki settings to save this picture.'
        );
    } finally {
        await act(async () => root.unmount());
        container.remove();
    }
});
