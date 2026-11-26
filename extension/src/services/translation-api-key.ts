// The user's DeepL API key for sentence translation. It stays in extension storage, outside settings.
export const translationApiKeyKey = 'deeplApiKey';
// Consent for the hosted web app to translate with that key. A new key, so consent given for the retired local
// translation service does not carry over.
export const webSentenceTranslationKey = 'webAppDeeplTranslation';
export const minimumTranslationApiKeyLength = 32; // DeepL keys are 36 characters, 39 with the Free plan's ":fx"

export const getTranslationApiKey = async (): Promise<string> => {
    const { [translationApiKeyKey]: key } = await browser.storage.local.get({ [translationApiKeyKey]: '' });
    return typeof key === 'string' ? key : '';
};
