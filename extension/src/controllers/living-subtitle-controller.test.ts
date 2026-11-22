import type { IndexedSubtitleModel } from '@project/common';
import LivingSubtitleController, { livingSubtitleWords } from '@/controllers/living-subtitle-controller';
import type { LivingSubtitleState, LivingSubtitleTarget } from '@/controllers/living-subtitle-controller';

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
    const actions = {
        pause: jest.fn(),
        define: jest.fn((word: string) => {
            const result = deferred();
            lookups.push({ word, result });
            return result.promise;
        }),
        mine: jest.fn((state: LivingSubtitleState) => {
            const result = deferred();
            mines.push({ state, result });
            return result.promise.then((outcome) => (outcome === 'dialog' ? 'dialog' : 'saved'));
        }),
        render: jest.fn(),
    };
    const controller = new LivingSubtitleController(actions);
    const state = (): LivingSubtitleState => actions.render.mock.lastCall![0];
    return { controller, actions, lookups, mines, state };
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
        expect(state().definition).toEqual({ status: 'success', text: 'coffee' });
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

    it('keeps the target word selectable while the definition fails, and retries', async () => {
        const { controller, lookups, state } = setup();
        controller.hover(target('Hij zet.'));
        void controller.selectWord(1);
        controller.useTargetWord();
        expect(state().targetWord?.text).toBe('zet');
        lookups[0].result.reject(new Error('unavailable'));
        await flush();
        expect(state().definition).toEqual({ status: 'error', message: 'unavailable' });

        controller.retryDefinition();
        expect(lookups).toHaveLength(2);
        expect(state().targetWord?.text).toBe('zet');
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

    it('mines once per request with a snapshot, and keeps the target on failure', async () => {
        const { controller, mines, state } = setup();
        controller.hover(target('Hij zet.'));
        void controller.selectWord(1);
        controller.useTargetWord();
        void controller.mine();
        void controller.mine();
        expect(mines).toHaveLength(1);
        expect(mines[0].state.targetWord?.text).toBe('zet');
        expect(state().mining.status).toBe('pending');
        expect(state().captured).toBe(true); // the next cue cannot replace a sentence being mined

        mines[0].result.reject(new Error('Anki is closed'));
        await flush();
        expect(state().mining).toEqual({ status: 'error', message: 'Anki is closed' });
        expect(state().targetWord?.text).toBe('zet');

        void controller.mine();
        mines[1].result.resolve('');
        await flush();
        expect(state().mining.status).toBe('success');

        void controller.mine();
        mines[2].result.resolve('dialog'); // the Anki dialog may still be cancelled
        await flush();
        expect(state().mining.status).toBe('idle');
    });

    it('keeps the target word meaning after its card closes', async () => {
        const { controller, lookups, state } = setup();
        controller.hover(target('Hij zet koffie.'));
        void controller.selectWord(1);
        controller.useTargetWord(); // chosen while the meaning is still loading
        lookups[0].result.resolve('puts');
        await flush();
        controller.closeWord();
        expect(state()).toMatchObject({ targetWord: { text: 'zet' }, targetDefinition: 'puts' });

        void controller.selectWord(2); // looking at another word keeps the target's meaning
        lookups[1].result.resolve('coffee');
        await flush();
        expect(state().targetDefinition).toBe('puts');
    });

    it('keeps a target meaning that arrives after its card closed', async () => {
        const { controller, lookups, state } = setup();
        controller.hover(target('Hij zet koffie.'));
        void controller.selectWord(1);
        controller.useTargetWord();
        controller.closeWord();
        lookups[0].result.resolve('puts');
        await flush();
        expect(state()).toMatchObject({ word: undefined, definition: { status: 'idle' }, targetDefinition: 'puts' });
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
});
