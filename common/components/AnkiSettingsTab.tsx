import { asbError } from '@project/common/util/log';
import FormHelperText from '@mui/material/FormHelperText';
import AnkiConnectTutorialBubble from '@project/common/components/AnkiConnectTutorialBubble';
import DeckFieldTutorialBubble from '@project/common/components/DeckFieldTutorialBubble';
import SettingsTextField from '@project/common/components/SettingsTextField';
import NumericSettingInput from '@project/common/components/NumericSettingInput';
import SettingsStatus from '@project/common/components/SettingsStatus';
import { Trans, useTranslation } from 'react-i18next';
import AnkiSelect from '@project/common/components/AnkiSelect';
import React, { useCallback, useEffect, useState } from 'react';
import TutorialBubble from '@project/common/components/TutorialBubble';
import RefreshIcon from '@mui/icons-material/Refresh';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';
import NoteTypeTutorialBubble from '@project/common/components/NoteTypeTutorialBubble';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Tooltip from '@mui/material/Tooltip';
import type { AsbplayerSettings, DictionaryTrack } from '@project/common/settings';
import type { CardModel } from '@project/common/src/model';
import { TutorialStep, sentenceTranslationField } from '@project/common/components/settings-model';
import { Anki, exportCard } from '@project/common/anki';
import Stack from '@mui/material/Stack';
import Autocomplete from '@mui/material/Autocomplete';

const defaultDeckName = 'Sentences';
const maskApiToken = (apiToken: string) => '•'.repeat(Array.from(apiToken).length);

const defaultNoteType = {
    modelName: 'Sentence Card',
    inOrderFields: ['Sentence', 'Word', 'Definition', sentenceTranslationField, 'Image', 'Audio', 'Source', 'URL'],
    css: `.card {
  font-family: arial;
  font-size: 20px;
  text-align: center;
  color: white;
  background-color: black;
}

.image {
  width: auto;
  height: auto;
  max-width: 500px;
  max-height: 500px;
  margin-left: auto;
  margin-right: auto;
}

.front {
  font-size: 30px;
}`,
    cardTemplates: [
        {
            Front: `<div class="front">{{Sentence}}</div>`,
            Back: `<div class="front">{{Sentence}}</div>
<hr id=answer>
{{${sentenceTranslationField}}}
<p/>
{{Definition}}
<p/>
<div class="image">
{{Image}}
</div>
<p/>
{{Audio}}
<p/>
{{Source}}
<p/>
{{URL}}`,
        },
    ],
};

interface Props {
    settings: AsbplayerSettings;
    isMobile?: boolean;
    insideApp?: boolean;
    inTutorial?: boolean;
    onSettingChanged: <K extends keyof AsbplayerSettings>(key: K, value: AsbplayerSettings[K]) => Promise<void>;
    tutorialStep: TutorialStep;
    onTutorialStepChanged: (step: TutorialStep) => void;
    anki: Anki;
    testCard?: () => Promise<CardModel>;
    /** False when the known-word source would be ignored: the web app's dictionary lives in an older extension. */
    knownWordsSupported?: boolean;
}

/** Padding below 0 would cut into the subtitle; blank or invalid input keeps the last value. */
const nonNegativeMs = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : undefined);

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : String(e));

const AnkiSettingsTab: React.FC<Props> = ({
    settings,
    isMobile,
    insideApp,
    inTutorial,
    onSettingChanged,
    tutorialStep,
    onTutorialStepChanged,
    anki,
    testCard,
    knownWordsSupported = true,
}) => {
    const { t } = useTranslation();

    const [deckNames, setDeckNames] = useState<string[]>();
    const [modelNames, setModelNames] = useState<string[]>();
    const [ankiConnectUrlError, setAnkiConnectUrlError] = useState<string>();
    const [ankiConnectApiKeyRequired, setAnkiConnectApiKeyRequired] = useState<boolean>(false);
    const [showAnkiConnectApiKey, setShowAnkiConnectApiKey] = useState<boolean>(() => !settings.ankiConnectApiKey);
    const [fieldNames, setFieldNames] = useState<string[]>();
    const [allFieldNames, setAllFieldNames] = useState<string[]>();

    const {
        ankiConnectUrl,
        ankiConnectApiKey,
        deck,
        noteType,
        sentenceField,
        definitionField,
        audioField,
        imageField,
        wordField,
        customAnkiFields,
        audioPaddingStart,
        audioPaddingEnd,
        dictionaryTracks,
    } = settings;

    const requestAnkiConnect = useCallback(async () => {
        let apiKeyRequired = false;
        const detectApiKeyRequired = (result: any) => {
            if (Anki.requiresApiKey(result)) apiKeyRequired = true;
        };

        try {
            if (insideApp) {
                try {
                    detectApiKeyRequired(await anki.requestPermission(ankiConnectUrl));
                } catch (e) {
                    // Request permission can give confusing errors due to AnkiConnect's implementation (or the implementation not existing in the case of Android).
                    // Furthermore, "request permission" should hardly ever work since recent Chrome security policies require the origin of the asbplayer app to
                    // be specified manually in the AnkiConnect settings anyway.
                    // So fallback to using the "version" endpoint if the above fails.
                    detectApiKeyRequired(e);
                    detectApiKeyRequired(await anki.version(ankiConnectUrl));
                }
            } else {
                // Extension does not need to be allowed explicitly by AnkiConnect
                detectApiKeyRequired(await anki.version(ankiConnectUrl));
            }

            setAnkiConnectApiKeyRequired(apiKeyRequired);
            setDeckNames(await anki.deckNames(ankiConnectUrl));
            setModelNames(await anki.modelNames(ankiConnectUrl));
            setAnkiConnectUrlError(undefined);
        } catch (e) {
            setAnkiConnectApiKeyRequired(apiKeyRequired || Anki.requiresApiKey(e));
            asbError('anki/connect', e);
            setDeckNames(undefined);
            setModelNames(undefined);
            setAnkiConnectUrlError(errorMessage(e));
        }
    }, [anki, ankiConnectUrl, insideApp]);

    useEffect(() => {
        let canceled = false;

        const timeout = setTimeout(() => {
            if (canceled) {
                return;
            }

            void requestAnkiConnect();
        }, 1000);

        return () => {
            canceled = true;
            clearTimeout(timeout);
        };
    }, [anki, ankiConnectUrl, ankiConnectApiKey, requestAnkiConnect]);

    // Its own request, so a failing note type empties only the word-field choices, not the connection.
    useEffect(() => {
        setAllFieldNames(undefined);
        if (!modelNames) return;
        let canceled = false;
        void anki.allFieldNames(ankiConnectUrl).then(
            (names) => !canceled && setAllFieldNames(names),
            (e) => asbError('anki/connect', e)
        );
        return () => {
            canceled = true;
        };
    }, [anki, ankiConnectUrl, modelNames]);

    useEffect(() => {
        if (!noteType || ankiConnectUrlError) {
            return undefined;
        }

        let canceled = false;

        async function refreshFieldNames() {
            try {
                if (canceled) {
                    return;
                }

                setFieldNames(await anki.modelFieldNames(noteType, ankiConnectUrl));
                setAnkiConnectUrlError(undefined);
            } catch (e) {
                if (canceled) {
                    return;
                }

                asbError('anki/connect', e);
                setFieldNames(undefined);
                setAnkiConnectUrlError(errorMessage(e));
            }
        }

        void refreshFieldNames();

        return () => {
            canceled = true;
        };
    }, [anki, noteType, ankiConnectUrl, ankiConnectApiKey, ankiConnectUrlError]);

    const handleCreateDefaultDeck = useCallback(() => {
        anki.createDeck(defaultDeckName)
            .then(() => requestAnkiConnect())
            .then(() => onSettingChanged('deck', defaultDeckName))
            .catch((error) => asbError('anki/connect', error));
    }, [anki, requestAnkiConnect, onSettingChanged]);

    useEffect(() => {
        if (tutorialStep === TutorialStep.deck && deck) {
            onTutorialStepChanged(TutorialStep.noteType);
        }
    }, [tutorialStep, onTutorialStepChanged, deck]);

    const handleCreateDefaultNoteType = useCallback(() => {
        anki.createModel(defaultNoteType)
            .then(() => requestAnkiConnect())
            .then(() => onSettingChanged('noteType', defaultNoteType.modelName))
            .then(() =>
                Promise.all([
                    onSettingChanged('sentenceField', 'Sentence'),
                    onSettingChanged('definitionField', 'Definition'),
                    onSettingChanged('wordField', 'Word'),
                    onSettingChanged('audioField', 'Audio'),
                    onSettingChanged('imageField', 'Image'),
                    onSettingChanged('sourceField', 'Source'),
                    onSettingChanged('urlField', 'URL'),
                    onSettingChanged('customAnkiFields', {
                        ...customAnkiFields,
                        [sentenceTranslationField]: sentenceTranslationField,
                    }),
                ])
            )
            .catch((error) => asbError('anki/connect', error));
        if (tutorialStep === TutorialStep.ankiFields) {
            onTutorialStepChanged(TutorialStep.testCard);
        }
    }, [anki, tutorialStep, customAnkiFields, requestAnkiConnect, onSettingChanged, onTutorialStepChanged]);

    const handleCreateTestCard = useCallback(async () => {
        if (testCard === undefined) {
            return;
        }

        if (tutorialStep === TutorialStep.testCard) {
            onTutorialStepChanged(TutorialStep.done);
        }

        await exportCard(await testCard(), settings, isMobile ? 'default' : 'gui');
    }, [tutorialStep, settings, isMobile, testCard, onTutorialStepChanged]);

    /** The i+1 vocabulary source lives on the main subtitle track; the other tracks keep their settings. */
    const knownWordsSelect = (
        key: 'dictionaryAnkiDecks' | 'dictionaryAnkiWordFields',
        label: string,
        helperText: string,
        options: string[] | undefined
    ) => (
        <Autocomplete
            multiple
            disableCloseOnSelect
            disabled={!knownWordsSupported}
            options={options ?? []}
            value={dictionaryTracks[0][key]}
            onChange={(_, value) =>
                void onSettingChanged(
                    'dictionaryTracks',
                    dictionaryTracks.map((dt, track): DictionaryTrack => (track === 0 ? { ...dt, [key]: value } : dt))
                )
            }
            renderInput={(params) => (
                <SettingsTextField
                    {...params}
                    label={label}
                    helperText={knownWordsSupported ? helperText : t('settings.knownWordsNeedExtensionUpdate')}
                />
            )}
        />
    );

    const ankiConnectApiKeyVisible = showAnkiConnectApiKey || !ankiConnectApiKey;
    const connected = deckNames !== undefined && !ankiConnectUrlError;
    const refreshButton = (
        <IconButton onClick={requestAnkiConnect} aria-label={t('action.refresh')}>
            <RefreshIcon />
        </IconButton>
    );

    return (
        <Stack spacing={1}>
            <AnkiConnectTutorialBubble
                show={tutorialStep === TutorialStep.ankiConnect}
                disabled={!inTutorial}
                ankiConnectUrlError={Boolean(ankiConnectUrlError)}
                onConfirm={() => {
                    onTutorialStepChanged(TutorialStep.deck);
                }}
            >
                {/* The URL is only editable while Anki isn't connected, which is the only time it needs changing */}
                {!connected ? (
                    <SettingsTextField
                        label={t('settings.ankiConnectUrl')}
                        value={ankiConnectUrl}
                        error={Boolean(ankiConnectUrlError)}
                        helperText={ankiConnectUrlError}
                        color="primary"
                        onChange={(event) => onSettingChanged('ankiConnectUrl', event.target.value)}
                        slotProps={{
                            input: { endAdornment: <InputAdornment position="end">{refreshButton}</InputAdornment> },
                        }}
                    />
                ) : (
                    <SettingsStatus state="ok" action={refreshButton}>
                        {t('settings.ankiConnected')}
                    </SettingsStatus>
                )}
            </AnkiConnectTutorialBubble>
            {(ankiConnectApiKey || ankiConnectApiKeyRequired) && (
                <SettingsTextField
                    label={t('settings.ankiConnectApiKey')}
                    value={ankiConnectApiKeyVisible ? ankiConnectApiKey : maskApiToken(ankiConnectApiKey)}
                    type="text"
                    color="primary"
                    onChange={(event) => onSettingChanged('ankiConnectApiKey', event.target.value)}
                    sx={{ '& input': { fontFamily: 'monospace' } }}
                    slotProps={{
                        input: {
                            disabled: !ankiConnectApiKeyVisible,
                            endAdornment: (
                                <InputAdornment position="end">
                                    <Tooltip title="">
                                        <IconButton
                                            onClick={() => setShowAnkiConnectApiKey((showKey) => !showKey)}
                                            onMouseDown={(event) => event.preventDefault()}
                                        >
                                            {ankiConnectApiKeyVisible ? <VisibilityOffIcon /> : <VisibilityIcon />}
                                        </IconButton>
                                    </Tooltip>
                                </InputAdornment>
                            ),
                        },
                    }}
                />
            )}
            {insideApp && ankiConnectUrlError && (
                <FormHelperText>
                    <Trans
                        i18nKey={'settings.corsHelperText'}
                        values={{ origin }}
                        components={[
                            <Link
                                key={0}
                                color="primary"
                                target="_blank"
                                rel="noreferrer"
                                href="https://youtu.be/Mv7fEVb6PHo?t=44"
                            >
                                video
                            </Link>,
                        ]}
                    />
                </FormHelperText>
            )}
            <DeckFieldTutorialBubble
                show={tutorialStep === TutorialStep.deck && !ankiConnectUrlError && !deck}
                disabled={!inTutorial}
                noDecks={deckNames === undefined || deckNames.length === 0}
                onCreateDefaultDeck={handleCreateDefaultDeck}
            >
                <AnkiSelect
                    label={t('settings.deck')}
                    value={deck}
                    selections={deckNames}
                    onValueChange={(value) => onSettingChanged('deck', value)}
                    onOpen={() => {
                        if (tutorialStep === TutorialStep.deck) {
                            onTutorialStepChanged(TutorialStep.noteType);
                        }
                    }}
                />
            </DeckFieldTutorialBubble>
            <NoteTypeTutorialBubble
                show={tutorialStep === TutorialStep.noteType && Boolean(deck) && !noteType}
                disabled={!inTutorial}
                noNoteTypes={modelNames === undefined || modelNames.length === 0}
                onCreateDefaultNoteType={handleCreateDefaultNoteType}
            >
                <AnkiSelect
                    label={t('settings.noteType')}
                    value={noteType}
                    selections={modelNames}
                    onValueChange={(value) => onSettingChanged('noteType', value)}
                    onOpen={() => {
                        if (tutorialStep === TutorialStep.noteType) {
                            onTutorialStepChanged(TutorialStep.ankiFields);
                        }
                    }}
                />
            </NoteTypeTutorialBubble>
            <TutorialBubble
                placement="bottom"
                disabled={!inTutorial}
                show={tutorialStep === TutorialStep.ankiFields && Boolean(deck) && Boolean(noteType)}
                disableArrow
                text={t('ftue.ankiFields')}
                onConfirm={() => onTutorialStepChanged(TutorialStep.testCard)}
            >
                <AnkiSelect
                    label={t('settings.sentenceField')}
                    value={sentenceField}
                    selections={fieldNames}
                    onValueChange={(value) => onSettingChanged('sentenceField', value)}
                />
            </TutorialBubble>
            <AnkiSelect
                label={t('settings.wordField')}
                value={wordField}
                selections={fieldNames}
                onValueChange={(value) => onSettingChanged('wordField', value)}
            />
            <AnkiSelect
                label={t('settings.definitionField')}
                value={definitionField}
                selections={fieldNames}
                onValueChange={(value) => onSettingChanged('definitionField', value)}
            />
            <AnkiSelect
                label={t('settings.translationField')}
                value={customAnkiFields[sentenceTranslationField] ?? ''}
                selections={fieldNames}
                onValueChange={(value) =>
                    onSettingChanged('customAnkiFields', { ...customAnkiFields, [sentenceTranslationField]: value })
                }
            />
            <AnkiSelect
                label={t('settings.audioField')}
                value={audioField}
                selections={fieldNames}
                onValueChange={(value) => onSettingChanged('audioField', value)}
            />
            <AnkiSelect
                label={t('settings.imageField')}
                value={imageField}
                selections={fieldNames}
                onValueChange={(value) => onSettingChanged('imageField', value)}
            />
            {knownWordsSelect(
                'dictionaryAnkiDecks',
                t('settings.knownWordDecks'),
                t('settings.knownWordDecksHelperText'),
                deckNames
            )}
            {knownWordsSelect(
                'dictionaryAnkiWordFields',
                t('settings.knownWordFields'),
                t('settings.knownWordFieldsHelperText'),
                allFieldNames
            )}
            <NumericSettingInput
                label={t('settings.audioPaddingStart')}
                fullWidth
                value={audioPaddingStart}
                normalizeValue={nonNegativeMs}
                onValueChange={(value) => void onSettingChanged('audioPaddingStart', value)}
                slotProps={{
                    htmlInput: { min: 0, step: 1 },
                    input: { endAdornment: <InputAdornment position="end">ms</InputAdornment> },
                }}
            />
            <NumericSettingInput
                label={t('settings.audioPaddingEnd')}
                fullWidth
                value={audioPaddingEnd}
                normalizeValue={nonNegativeMs}
                onValueChange={(value) => void onSettingChanged('audioPaddingEnd', value)}
                slotProps={{
                    htmlInput: { min: 0, step: 1 },
                    input: { endAdornment: <InputAdornment position="end">ms</InputAdornment> },
                }}
            />
            {testCard && (
                <TutorialBubble
                    placement="top"
                    disabled={!inTutorial}
                    show={tutorialStep === TutorialStep.testCard}
                    text={t('ftue.testCard')}
                    onConfirm={() => onTutorialStepChanged(TutorialStep.done)}
                >
                    <Button variant="contained" onClick={handleCreateTestCard} sx={{ alignSelf: 'flex-start' }}>
                        {t('settings.createTestCard')}
                    </Button>
                </TutorialBubble>
            )}
        </Stack>
    );
};

export default AnkiSettingsTab;
