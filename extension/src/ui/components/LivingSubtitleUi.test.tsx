import { expect, it, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import Bridge from '@/ui/bridge';
import LivingSubtitleUi from '@/ui/components/LivingSubtitleUi';
import type { LivingSubtitleViewModel } from '@/ui/components/LivingSubtitleUi';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('reports its first size even when the hidden frame receives no ResizeObserver callback', () => {
    const originalObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
    Object.defineProperty(globalThis, 'ResizeObserver', {
        configurable: true,
        value: class {
            observe() {}
            disconnect() {}
        },
    });
    const dimensions = { x: 0, y: 0, top: 0, left: 0, width: 360, height: 54, right: 360, bottom: 54 };
    const measure = jest
        .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
        .mockReturnValue({ ...dimensions, toJSON: () => dimensions });
    const bridge = new Bridge();
    const onMessage = jest.fn();
    bridge.addServerMessageListener(onMessage);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const state: LivingSubtitleViewModel = {
        themeType: 'dark',
        words: ['Ik', 'kom', 'zo', 'terug'],
        wordIndex: 1,
        definition: { status: 'idle' },
        mining: { status: 'idle' },
        known: { status: 'idle' },
        maxWidth: 640,
        maxHeight: 360,
    };
    try {
        act(() => root.render(<LivingSubtitleUi bridge={bridge} />));
        const message = { command: 'updateState', state };
        act(() => bridge.sendMessageFromClient(message));
        expect(onMessage).toHaveBeenCalledWith({ command: 'size', width: 360, height: 54 });
    } finally {
        act(() => root.unmount());
        container.remove();
        measure.mockRestore();
        if (originalObserver) Object.defineProperty(globalThis, 'ResizeObserver', originalObserver);
        else Reflect.deleteProperty(globalThis, 'ResizeObserver');
    }
});
