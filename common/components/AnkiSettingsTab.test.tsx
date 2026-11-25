import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, jest } from '@jest/globals';
import { ThemeProvider } from '@mui/material/styles';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { Anki, exportCard } from '@project/common/anki';
import AnkiSettingsTab from '@project/common/components/AnkiSettingsTab';
import { TutorialStep } from '@project/common/components/settings-model';
import en from '@project/common/locales/en.json';
import { SettingsProvider } from '@project/common/settings';
import { MockSettingsStorage } from '@project/common/settings/mock-settings-storage';
import { createTheme } from '@project/common/theme';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('maps a note type field to the picture on a newly exported card', async () => {
    const settingsProvider = new SettingsProvider(new MockSettingsStorage());
    await settingsProvider.set({ deck: 'Dutch', noteType: 'Mined sentence', sentenceField: 'Sentence' });
    const settings = await settingsProvider.getAll();
    const fetcher = {
        fetch: jest.fn(async (_url: string, { action }: { action: string }) => ({
            result: action === 'modelFieldNames' ? ['Sentence', 'Picture'] : 123,
            error: null,
        })),
    };
    const i18n = createInstance();
    await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
        await act(async () =>
            root.render(
                <I18nextProvider i18n={i18n}>
                    <ThemeProvider theme={createTheme('dark')}>
                        <AnkiSettingsTab
                            settings={settings}
                            anki={new Anki(settings, fetcher)}
                            onSettingChanged={(key, value) => settingsProvider.set({ [key]: value })}
                            tutorialStep={TutorialStep.done}
                            onTutorialStepChanged={() => {}}
                        />
                    </ThemeProvider>
                </I18nextProvider>
            )
        );

        const imageLabel = Array.from(container.querySelectorAll('label')).find(
            (label) => label.textContent === en.settings.imageField
        );
        expect(imageLabel).toBeDefined();
        const menuButton = imageLabel!.parentElement!.querySelector('button')!;
        menuButton.getBoundingClientRect = () => new DOMRect(10, 10, 20, 20);
        await act(async () => menuButton.click());
        const pictureOption = Array.from(document.querySelectorAll<HTMLElement>('[role="button"]')).find(
            (option) => option.textContent === 'Picture'
        );
        expect(pictureOption).toBeDefined();
        await act(async () => pictureOption!.click());
    } finally {
        act(() => root.unmount());
        container.remove();
    }

    const base64 = 'UklGRjYAAABXRUJQVlA4ICoAAACQAQCdASoBAAEAAUAmJaACdLoAA5gA/u3O3+HKn07O7/5Bjt57ed2AAAA=';
    const noteId = await exportCard(
        {
            subtitle: { text: 'Ik zie een foto.', start: 0, end: 1000, originalStart: 0, originalEnd: 1000, track: 0 },
            subtitleFileName: 'episode.srt',
            surroundingSubtitles: [],
            image: { base64, extension: 'webp' },
            mediaTimestamp: 0,
        },
        await settingsProvider.getAll(),
        'default',
        fetcher
    );

    expect(noteId).toBe(123);
    expect(fetcher.fetch).toHaveBeenLastCalledWith(
        settings.ankiConnectUrl,
        expect.objectContaining({
            action: 'addNote',
            params: {
                note: expect.objectContaining({
                    picture: expect.objectContaining({ data: base64, fields: ['Picture'] }),
                }),
            },
        })
    );
});

it('edits the known-word decks on the main track only, keeping its other settings', async () => {
    const settingsProvider = new SettingsProvider(new MockSettingsStorage());
    const initial = await settingsProvider.getAll();
    const [main, ...others] = initial.dictionaryTracks;
    await settingsProvider.set({
        dictionaryTracks: [
            { ...main, dictionaryAnkiDecks: ['Dutch'], dictionaryYomitanUrl: 'http://yomitan' },
            ...others,
        ],
    });
    const settings = await settingsProvider.getAll();
    const onSettingChanged = jest.fn(async () => {});
    const i18n = createInstance();
    await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
        await act(async () =>
            root.render(
                <I18nextProvider i18n={i18n}>
                    <ThemeProvider theme={createTheme('dark')}>
                        <AnkiSettingsTab
                            settings={settings}
                            anki={new Anki(settings, { fetch: jest.fn(async () => ({ result: [], error: null })) })}
                            onSettingChanged={onSettingChanged}
                            tutorialStep={TutorialStep.done}
                            onTutorialStepChanged={() => {}}
                        />
                    </ThemeProvider>
                </I18nextProvider>
            )
        );
        const removeDutch = container.querySelector('.MuiChip-deleteIcon')!;
        await act(async () => removeDutch.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    } finally {
        act(() => root.unmount());
        container.remove();
    }

    expect(onSettingChanged).toHaveBeenCalledWith('dictionaryTracks', [
        { ...settings.dictionaryTracks[0], dictionaryAnkiDecks: [] },
        settings.dictionaryTracks[1],
        settings.dictionaryTracks[2],
    ]);
});
