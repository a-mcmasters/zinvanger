export enum TutorialStep {
    ankiConnect = 1,
    deck = 2,
    noteType = 3,
    ankiFields = 4,
    testCard = 5,
    done,
}

export enum Direction {
    up = 1,
    down = 2,
}

// Anki field the mining dialog fills with the English translation (mapped via customAnkiFields)
export const sentenceTranslationField = 'Sentence Translation';
