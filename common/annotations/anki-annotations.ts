import { asbError, asbTrace, asbWarn } from '@project/common/util/log';
import type { DictionaryBuildAnkiCacheState, DictionaryBuildAnkiCacheStateError, Fetcher } from '@project/common';
import { DictionaryBuildAnkiCacheStateErrorCode, DictionaryBuildAnkiCacheStateType } from '@project/common';
import { Anki } from '@project/common/anki';
import type { AsbplayerSettings, DictionaryTrack, SettingsProvider } from '@project/common/settings';
import { ankiStatusTrack, ankiVocabularySource } from '@project/common/settings';
import { effectiveSettings } from '@project/common/settings/settings-recipes';
import type { DictionaryProvider } from '@project/common/dictionary-db';
import type {
    DictionaryStatisticsAnkiDueCardsSnapshot,
    DictionaryStatisticsAnkiSnapshot,
} from '@project/common/dictionary-statistics';
import { REVIEW_DUES } from '@project/common/dictionary-statistics';

const ANKI_REFRESH_INTERVAL = 10000; // We need to poll in-case the user mines to Anki outside of asbplayer (e.g directly from Yomitan), local requests so no rate concerns

export interface AnkiAnnotationsOptions {
    dictionaryProvider: DictionaryProvider;
    settingsProvider: SettingsProvider;
    fetcher?: Fetcher;
    getProfile: () => string | undefined | null;
    getTracks: () => readonly { track: number; dt: DictionaryTrack }[];
    generateStatistics: () => boolean | undefined;
    tokensWereModified: (tokens: string[]) => void;
    replaceStatisticsSnapshot: (snapshot: DictionaryStatisticsAnkiSnapshot) => void;
}

export class AnkiAnnotations {
    private readonly options: AnkiAnnotationsOptions;
    private anki: Anki | undefined;
    private lastSettings?: { url: string; apiKey: string };
    private connectionError = false;
    private recentlyModifiedCardIds = new Set<number>();
    private recentlyModifiedFirstCheck = true;
    private generation = 0;
    private refreshingGeneration?: number;
    private refreshed = false;
    private lastRefresh = Date.now();
    private triggerRefresh = false;
    private statisticsRefreshed = false;

    constructor(options: AnkiAnnotationsOptions) {
        this.options = options;
    }

    reset(): void {
        this.generation++;
        this.anki = undefined;
        this.recentlyModifiedCardIds.clear();
        this.recentlyModifiedFirstCheck = true;
        this.refreshed = false;
        this.lastRefresh = Date.now();
        this.triggerRefresh = false;
        this.statisticsRefreshed = false;
    }

    updateSettings(settings: AsbplayerSettings): boolean {
        const changed =
            this.lastSettings === undefined ||
            this.lastSettings.url !== settings.ankiConnectUrl ||
            this.lastSettings.apiKey !== settings.ankiConnectApiKey;
        this.lastSettings = { url: settings.ankiConnectUrl, apiKey: settings.ankiConnectApiKey };
        return changed;
    }

    requestRefresh(): void {
        this.triggerRefresh = true;
    }

    cacheStateChanged(state: DictionaryBuildAnkiCacheState): void {
        const modifiedTokens = state.body?.modifiedTokens ?? [];
        asbTrace('annotations/anki', 'Anki cache state changed', {
            modifiedTokenCount: modifiedTokens.length,
            type: state.type,
        });
        this.options.tokensWereModified(modifiedTokens);
        if (state.type === DictionaryBuildAnkiCacheStateType.error) {
            const body = state.body as DictionaryBuildAnkiCacheStateError;
            if (
                body?.code === DictionaryBuildAnkiCacheStateErrorCode.noAnki ||
                body?.code === DictionaryBuildAnkiCacheStateErrorCode.noYomitan
            ) {
                this.statisticsRefreshed = false;
            }
            if (body) {
                asbError(
                    'annotations/anki',
                    `Dictionary Anki cache build error (${body.code} - ${body.msg}): ${JSON.stringify(body.data ?? {})}`
                );
            } else {
                asbError('annotations/anki', 'Dictionary Anki cache build error: Unknown error');
            }
            if (body?.code !== DictionaryBuildAnkiCacheStateErrorCode.concurrentBuild) {
                this.recentlyModifiedCardIds.clear();
                this.recentlyModifiedFirstCheck = false;
            }
        } else if (state.type === DictionaryBuildAnkiCacheStateType.stats) {
            this.statisticsRefreshed = false;
        }
    }

    cardWasModified(): void {
        asbTrace('annotations/anki', 'Anki card modification scheduled an annotation refresh');
        this.triggerRefresh = true;
        this.statisticsRefreshed = false;
    }

    private get refreshing(): boolean {
        return this.refreshingGeneration === this.generation;
    }

    refreshIfDue(): void {
        if ((this.triggerRefresh || Date.now() - this.lastRefresh >= ANKI_REFRESH_INTERVAL) && !this.refreshing) {
            void this.refresh();
            this.lastRefresh = Date.now();
            this.triggerRefresh = false;
        }
    }

    async refresh(): Promise<void> {
        const profile = this.options.getProfile();
        if (profile === null || !this.options.getTracks().length || this.refreshing) return;
        const generation = this.generation;
        const startedAt = Date.now();
        asbTrace('annotations/anki', 'Starting Anki refresh', {
            generateStatistics: this.options.generateStatistics() === true,
            trackCount: this.options.getTracks().length,
        });
        try {
            this.refreshingGeneration = generation;
            const settings = effectiveSettings(await this.options.settingsProvider.getAll());
            if (generation !== this.generation) return;
            if (!this.anki) {
                try {
                    if (this.lastSettings === undefined) this.updateSettings(settings);
                    const anki = new Anki(settings, this.options.fetcher);
                    const permission = (await anki.requestPermission()).permission;
                    if (generation !== this.generation) return;
                    if (permission !== 'granted') throw new Error(`permission ${permission}`);
                    this.anki = anki;
                    this.connectionError = false;
                } catch (e) {
                    if (generation !== this.generation) return;
                    if (!this.connectionError) {
                        asbWarn('annotations/anki', 'Anki permission request failed:', e);
                        this.connectionError = true;
                    }
                    this.anki = undefined;
                }
            }
            const tracks = this.options.getTracks();
            const ankiTracks = tracks.flatMap(({ dt, track }) => ankiStatusTrack(dt, track) ?? []);
            const allFieldsSet = new Set<string>();
            for (const dt of ankiTracks) {
                for (const field of dt.dictionaryAnkiWordFields.concat(dt.dictionaryAnkiSentenceFields)) {
                    allFieldsSet.add(field);
                }
            }
            const fields = Array.from(allFieldsSet);
            const allDecksSet = new Set<string>();
            for (const dt of ankiTracks) {
                if (!dt.dictionaryAnkiDecks.length) {
                    allDecksSet.clear(); // Query all decks
                    break;
                }
                for (const deck of dt.dictionaryAnkiDecks) allDecksSet.add(deck);
            }
            const decks = Array.from(allDecksSet);
            if (this.anki && !this.refreshed) {
                // Keep cache updated without user action
                await this.options.dictionaryProvider.buildAnkiCache(profile, settings);
                if (generation !== this.generation) return;
                const dictionary = this.options.dictionaryProvider;
                // A build request can return while the build is running, or if it couldn't start.
                const stamps = dictionary.supportsAnkiCacheSource
                    ? await Promise.all(
                          tracks.flatMap(({ dt, track }) => {
                              const source = ankiVocabularySource(settings.ankiConnectUrl, dt, track);
                              return source === undefined
                                  ? []
                                  : [dictionary.getAnkiCacheSource(profile, track).then((stamp) => stamp === source)];
                          })
                      )
                    : [];
                if (generation !== this.generation) return;
                this.refreshed = stamps.every(Boolean);
            }
            await this.checkRecentlyModifiedCards(profile, fields, decks, settings, generation);
            if (generation !== this.generation) return;
            await this.refreshStatistics(profile, fields, decks, generation);
        } catch (e) {
            if (generation !== this.generation) return;
            if (!this.connectionError) {
                asbWarn('annotations/anki', 'Anki refresh failed:', e);
                this.connectionError = true;
            }
            this.refreshed = false;
        } finally {
            if (this.refreshingGeneration === generation) this.refreshingGeneration = undefined;
            asbTrace('annotations/anki', 'Finished Anki refresh', {
                durationMs: Date.now() - startedAt,
                refreshed: this.refreshed,
                statisticsRefreshed: this.statisticsRefreshed,
            });
        }
    }

    private async checkRecentlyModifiedCards(
        profile: string | undefined,
        fields: string[],
        decks: string[],
        settings: AsbplayerSettings,
        generation: number
    ) {
        try {
            if (!this.anki) throw new Error('Anki not initialized');
            const cardIds = await this.anki.findRecentlyEditedOrReviewedCards(1, fields, decks); // Can't efficiently poll suspended status
            if (generation !== this.generation) return;
            this.connectionError = false;
            if (
                cardIds.length === this.recentlyModifiedCardIds.size &&
                cardIds.every((cardId) => this.recentlyModifiedCardIds.has(cardId))
            ) {
                if (this.recentlyModifiedFirstCheck) this.recentlyModifiedFirstCheck = false;
                return;
            }
            this.recentlyModifiedCardIds = new Set(cardIds);
            if (this.recentlyModifiedFirstCheck) {
                this.recentlyModifiedFirstCheck = false;
                return;
            }
            if (this.refreshed) {
                await this.options.dictionaryProvider.buildAnkiCache(profile, settings);
                if (generation !== this.generation) return;
                this.triggerRefresh = true;
            }
            this.statisticsRefreshed = false;
        } catch (e) {
            if (generation !== this.generation) return;
            if (!this.connectionError) {
                asbError('annotations/anki', 'Error checking Anki recently modified cards:', e);
                this.connectionError = true;
            }
            this.anki = undefined;
            this.recentlyModifiedCardIds.clear();
            this.recentlyModifiedFirstCheck = false;
        }
    }

    private async refreshStatistics(
        profile: string | undefined,
        fields: string[],
        decks: string[],
        generation: number
    ) {
        if (!this.options.generateStatistics() || this.statisticsRefreshed) return;
        const startedAt = Date.now();
        try {
            const anki = this.anki;
            if (!anki) throw new Error('Anki not initialized');
            const ankiCardRecords = (await this.options.dictionaryProvider.getRecords(profile, undefined))
                .ankiCardRecords;
            const cardsInfo: DictionaryStatisticsAnkiSnapshot['cardsInfo'] = {};
            const cardsStatus: NonNullable<DictionaryStatisticsAnkiSnapshot['cardsStatus']> = {};
            for (const cardRecords of Object.values(ankiCardRecords)) {
                for (const cardRecord of Object.values(cardRecords)) {
                    cardsInfo[cardRecord.cardId] = cardRecord.data!;
                    cardsStatus[cardRecord.cardId] = cardRecord.status;
                }
            }

            // Fallback to requesting from Anki if extension and therefore the db hasn't been updated
            if (Object.keys(cardsInfo).length && !Object.values(cardsInfo)[0]) {
                for (const cardInfo of await anki.cardsInfo(Object.keys(cardsInfo).map((id) => parseInt(id)))) {
                    cardsInfo[cardInfo.cardId] = {
                        deckName: cardInfo.deckName,
                        modelName: cardInfo.modelName,
                        due: cardInfo.due,
                    };
                }
            }
            const dueCards: DictionaryStatisticsAnkiDueCardsSnapshot = {};
            for (const due of REVIEW_DUES) dueCards[due] = await anki.findCardsDueBy(due, fields, decks);
            if (generation !== this.generation) return;
            const totalCards = Object.keys(cardsStatus).length;
            this.options.replaceStatisticsSnapshot({
                available: true,
                progress: { current: totalCards, total: totalCards, startedAt },
                cardsInfo,
                cardsStatus,
                dueCards,
            });
            this.statisticsRefreshed = true;
            this.connectionError = false;
        } catch (e) {
            if (generation !== this.generation) return;
            if (!this.connectionError) {
                asbError('annotations/anki', 'Error refreshing Anki for statistics:', e);
                this.connectionError = true;
            }
            this.anki = undefined;
            this.options.replaceStatisticsSnapshot({
                available: false,
                cardsInfo: {},
                cardsStatus: {},
                dueCards: {},
            });
        }
    }
}
