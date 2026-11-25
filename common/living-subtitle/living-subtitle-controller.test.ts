import type { IndexedSubtitleModel } from '@project/common';
import LivingSubtitleController, {
    distinctLemma,
    livingSubtitleWords,
} from '@project/common/living-subtitle/living-subtitle-controller';
import type {
    LivingSubtitleState,
    LivingSubtitleTarget,
} from '@project/common/living-subtitle/living-subtitle-controller';

const cue = (text: string, overrides: Partial<IndexedSubtitleModel> = {}): IndexedSubtitleModel => ({
    text,
    start: 1000,
    end: 2000,
    originalStart: 1000,
    originalEnd: 2000,
    track: 0,
    index: 0,
    ...overrides,
});

const target = (text: string, overrides: Partial<IndexedSubtitleModel> = {}): LivingSubtitleTarget => ({
    video: 'video',
    cue: cue(text, overrides),
    surrounding: [],
});

const deferred = () => {
    let resolve!: (value: string) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<string>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};

const setup = () => {
    const lookups: { word: string; result: ReturnType<typeof deferred> }[] = [];
    const mines: { state: LivingSubtitleState; result: ReturnType<typeof deferred> }[] = [];
    const knowns: { word: string; lemmas: readonly string[]; result: ReturnType<typeof deferred> }[] = [];
    const actions = {
        pause: jest.fn(),
        define: jest.fn((word: string) => {
            const result = deferred();
            lookups.push({ word, result });
            return result.promise.then((text) => ({ text, lemmas: text ? [`${word}-lemma`] : [] }));
        }),
        mine: jest.fn((state: LivingSubtitleState) => {
            const result = deferred();
            mines.push({ state, result });
            return result.promise.then((outcome) => (outcome === 'dialog' ? 'dialog' : 'saved'));
        }),
        markKnown: jest.fn((word: string, lemmas: readonly string[]) => {
            const result = deferred();
            knowns.push({ word, lemmas, result });
            return result.promise.then(() => undefined);
        }),
        render: jest.fn(),
    };
    const controller = new LivingSubtitleController(actions);
    const state = (): LivingSubtitleState => actions.render.mock.lastCall![0];
    return { controller, actions, lookups, mines, knowns, state };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('livingSubtitleWords', () => {
    it('keeps diacritics and internal apostrophes or hyphens, without punctuation', () => {
        expect(livingSubtitleWords("“Zo'n café-avond, hè?” zei ze.").map((word) => word.text)).toEqual([
            "Zo'n",
            'café-avond',
            'hè',
            'zei',
            'ze',
        ]);
        expect(livingSubtitleWords('—').length).toBe(0);
    });
});

describe('distinctLemma', () => {
    it('shows only a dictionary form that is a different word', () => {
        expect(distinctLemma('hadden', 'hebben')).toBe('hebben');
        expect(distinctLemma('Hij', 'hij')).toBeUndefined();
        expect(distinctLemma('zet', undefined)).toBeUndefined();
        expect(distinctLemma('zet', '')).toBeUndefined();
    });
});

describe('LivingSubtitleController', () => {
    it('hover shows a target without pausing; capture pauses and freezes it', () => {
        const { controller, actions, state } = setup();
        controller.hover(target('Een zin.'));
        expect(actions.pause).not.toHaveBeenCalled();
        expect(state().target?.cue.text).toBe('Een zin.');

        controller.hover(target('Tweede zin.', { index: 1, start: 3000, end: 4000 }));
        expect(state().target?.cue.text).toBe('Tweede zin.');

        controller.capture();
        expect(actions.pause).toHaveBeenCalledTimes(1);
        controller.hover(target('Derde zin.', { index: 2, start: 5000, end: 6000 }));
        expect(state().target?.cue.text).toBe('Tweede zin.');
        expect(state().captured).toBe(true);
    });

    it('keeps the target across unrelated or re-indexing updates, and clears on replacement', () => {
        const { controller, state } = setup();
        controller.hover(target('Een zin.', { source: { loadId: 'load', cueId: 3 } }));
        controller.capture();

        controller.reconcile((current) => ({ ...current, cue: { ...current.cue, index: 7 } }));
        expect(state().target?.cue.index).toBe(7);
        expect(state().captured).toBe(true);

        controller.reconcile((current) => ({ ...current, cue: { ...current.cue, text: 'Een andere zin.' } }));
        expect(state().target).toBeUndefined();
    });

    it('clears on offset change, missing cue or a different video', () => {
        for (const resolve of [
            (current: LivingSubtitleTarget) => ({ ...current, cue: { ...current.cue, start: 1500, end: 2500 } }),
            () => undefined,
            (current: LivingSubtitleTarget) => ({ ...current, video: 'other' }),
        ]) {
            const { controller, state } = setup();
            controller.hover(target('Een zin.'));
            controller.reconcile(resolve);
            expect(state().target).toBeUndefined();
        }
    });

    it('requests a definition only on explicit selection and ignores stale answers', async () => {
        const { controller, lookups, state } = setup();
        controller.hover(target('Hij zet de koffie.'));
        expect(lookups).toHaveLength(0);

        void controller.selectWord(1);
        void controller.selectWord(3);
        expect(lookups.map((lookup) => lookup.word)).toEqual(['zet', 'koffie']);
        lookups[1].result.resolve('coffee');
        await flush();
        lookups[0].result.resolve('puts');
        await flush();
        expect(state().word?.text).toBe('koffie');
        expect(state().definition).toEqual({ status: 'success', text: 'coffee', lemmas: ['koffie-lemma'] });
    });

    it('drops answers for a previous sentence', async () => {
        const { controller, lookups, state } = setup();
        controller.hover(target('Hij zet.'));
        void controller.selectWord(1);
        controller.clear();
        controller.hover(target('Een andere zin.', { index: 1, start: 3000, end: 4000 }));
        lookups[0].result.resolve('puts');
        await flush();
        expect(state().definition).toEqual({ status: 'idle' });
        expect(state().word).toBeUndefined();
    });

    it('keeps the word while the definition fails, and retries', async () => {
        const { controller, lookups, state } = setup();
        controller.hover(target('Hij zet.'));
        void controller.selectWord(1);
        lookups[0].result.reject(new Error('unavailable'));
        await flush();
        expect(state().definition).toEqual({ status: 'error', message: 'unavailable' });

        controller.retryDefinition();
        expect(lookups).toHaveLength(2);
        expect(state().word?.text).toBe('zet');
    });

    it('escape closes the word card, then the interaction', () => {
        const { controller, actions, lookups, state } = setup();
        controller.hover(target('Een twee drie.'));
        void controller.selectWord(2);
        expect(actions.pause).toHaveBeenCalled();
        expect(lookups[0].word).toBe('drie');

        controller.escape();
        expect(state().word).toBeUndefined();
        expect(state().target).toBeDefined();
        controller.escape();
        expect(state().target).toBeUndefined();
    });

    it('mines the clicked word once per request with a snapshot, and keeps it on failure', async () => {
        const { controller, lookups, mines, state } = setup();
        controller.hover(target('Hij zet.'));
        void controller.mine();
        expect(mines).toHaveLength(0); // no word clicked yet
        void controller.selectWord(1);
        lookups[0].result.resolve('puts');
        await flush();
        void controller.mine();
        void controller.mine();
        expect(mines).toHaveLength(1);
        expect(mines[0].state).toMatchObject({ word: { text: 'zet' }, definition: { text: 'puts' } });
        expect(state().mining.status).toBe('pending');
        expect(state().captured).toBe(true); // the next cue cannot replace a sentence being mined

        mines[0].result.reject(new Error('Anki is closed'));
        await flush();
        expect(state().mining).toEqual({ status: 'error', message: 'Anki is closed' });
        expect(state().word?.text).toBe('zet');
        void controller.selectWord(0);
        expect(state().mining).toEqual({ status: 'idle' }); // the error was about "zet"
        void controller.selectWord(1);
        lookups.at(-1)!.result.resolve('puts');
        await flush();

        void controller.mine();
        mines[1].result.resolve('');
        await flush();
        expect(state().mining.status).toBe('success');

        void controller.mine();
        mines[2].result.resolve('dialog'); // the Anki dialog may still be cancelled
        await flush();
        expect(state().mining.status).toBe('idle');
    });

    it('renders nothing after dispose and ignores late results', async () => {
        const { controller, actions, lookups } = setup();
        controller.hover(target('Hij zet.'));
        void controller.selectWord(1);
        controller.dispose();
        const renders = actions.render.mock.calls.length;
        lookups[0].result.resolve('puts');
        await flush();
        controller.hover(target('Hij zet.'));
        expect(actions.render.mock.calls.length).toBe(renders);
    });

    describe('Known', () => {
        const opened = async (text = 'Hij zet de koffie.', index = 1, meaning = 'puts') => {
            const setup_ = setup();
            setup_.controller.hover(target(text));
            void setup_.controller.selectWord(index);
            setup_.lookups.at(-1)!.result.resolve(meaning);
            await flush();
            return setup_;
        };

        it('saves the clicked word with the lookup lemmas once, and confirms', async () => {
            const { controller, knowns, state } = await opened();
            void controller.markKnown();
            void controller.markKnown(); // a double click while saving
            expect(knowns).toEqual([expect.objectContaining({ word: 'zet', lemmas: ['zet-lemma'] })]);
            expect(state().known?.status).toBe('pending');

            knowns[0].result.resolve('');
            await flush();
            expect(state().known?.status).toBe('success');
            expect(state().word?.text).toBe('zet'); // the card stays open
        });

        it('waits for the lookup, so the save stores the forms the status resolver queries', async () => {
            const { controller, lookups, knowns } = setup();
            controller.hover(target('Hij liep.'));
            void controller.selectWord(1);
            void controller.markKnown();
            expect(knowns).toHaveLength(0);

            lookups[0].result.resolve('walked');
            await flush();
            void controller.markKnown();
            expect(knowns).toEqual([expect.objectContaining({ word: 'liep', lemmas: ['liep-lemma'] })]);
        });

        it('saves the surface form alone when the lookup failed', async () => {
            const { controller, lookups, knowns } = setup();
            controller.hover(target('Hij zet.'));
            void controller.selectWord(1);
            lookups[0].result.reject(new Error('dictionaryUnavailable'));
            await flush();
            void controller.markKnown();
            expect(knowns[0]).toMatchObject({ word: 'zet', lemmas: [] });
        });

        it('times out a stalled lookup, permits Known without lemmas and lets Retry replace the lookup', async () => {
            jest.useFakeTimers();
            try {
                const { controller, lookups, knowns, state, actions } = setup();
                controller.hover(target('Hij liep.'));
                void controller.selectWord(1);
                await jest.advanceTimersByTimeAsync(10_000);

                expect(state().definition).toEqual({ status: 'error', message: 'dictionaryUnavailable' });
                void controller.markKnown();
                expect(knowns[0]).toMatchObject({ word: 'liep', lemmas: [] });

                controller.retryDefinition();
                expect(actions.define).toHaveBeenLastCalledWith('liep', true);
                lookups[1].result.resolve('walked');
                await jest.advanceTimersByTimeAsync(0);
                lookups[0].result.resolve('stale');
                await jest.advanceTimersByTimeAsync(0);
                expect(state().definition).toMatchObject({ status: 'success', text: 'walked' });
            } finally {
                jest.useRealTimers();
            }
        });

        it('offers no Known for a word without letters', async () => {
            const { controller, knowns, state } = await opened('Om 2024 uur.', 1, '');
            void controller.markKnown();
            expect(knowns).toHaveLength(0);
            expect(state().known).toBeUndefined();
        });

        it('reports a rejected write, and a retry confirms once', async () => {
            const { controller, knowns, state, actions } = await opened();
            void controller.markKnown();
            knowns[0].result.reject(new Error('quota'));
            await flush();
            expect(state().known).toEqual({ status: 'error', message: 'quota' });

            void controller.markKnown();
            knowns[1].result.resolve('');
            await flush();
            expect(state().known?.status).toBe('success');
            const confirmations = actions.render.mock.calls.filter(([s]) => s.known?.status === 'success');
            expect(confirmations).toHaveLength(1);
        });

        it('gives up on a write that never answers', async () => {
            jest.useFakeTimers();
            try {
                const { controller, lookups, state } = setup();
                controller.hover(target('Hij zet.'));
                void controller.selectWord(1);
                lookups[0].result.resolve('puts');
                await jest.advanceTimersByTimeAsync(0);
                void controller.markKnown();
                await jest.advanceTimersByTimeAsync(10_000);
                expect(state().known).toEqual({ status: 'error', message: 'timeout' });
            } finally {
                jest.useRealTimers();
            }
        });

        it('drops a confirmation after close, word change or clear', async () => {
            for (const leave of [
                (controller: LivingSubtitleController) => controller.closeWord(),
                (controller: LivingSubtitleController) => void controller.selectWord(3),
                (controller: LivingSubtitleController) => controller.clear(),
            ]) {
                const { controller, knowns, state } = await opened();
                void controller.markKnown();
                leave(controller);
                knowns[0].result.resolve('');
                await flush();
                expect(state().known ?? { status: 'idle' }).toEqual({ status: 'idle' });
            }
        });

        it('keeps the Known result across a definition retry', async () => {
            const { controller, knowns, lookups, state } = await opened();
            void controller.markKnown();
            knowns[0].result.resolve('');
            await flush();
            controller.retryDefinition();
            expect(lookups).toHaveLength(2);
            expect(state().known?.status).toBe('success');
        });
    });
});
