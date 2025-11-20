/**
 * Romaji to Japanese (Hiragana/Katakana) Converter
 * Used for converting romanized Japanese text back to Japanese characters
 * for better MusicBrainz matching
 */

// Romaji to Hiragana mapping
const ROMAJI_TO_HIRAGANA = {
    // Vowels
    'a': 'あ', 'i': 'い', 'u': 'う', 'e': 'え', 'o': 'お',

    // K-sounds
    'ka': 'か', 'ki': 'き', 'ku': 'く', 'ke': 'け', 'ko': 'こ',
    'kya': 'きゃ', 'kyu': 'きゅ', 'kyo': 'きょ',

    // G-sounds
    'ga': 'が', 'gi': 'ぎ', 'gu': 'ぐ', 'ge': 'げ', 'go': 'ご',
    'gya': 'ぎゃ', 'gyu': 'ぎゅ', 'gyo': 'ぎょ',

    // S-sounds
    'sa': 'さ', 'shi': 'し', 'su': 'す', 'se': 'せ', 'so': 'そ',
    'sha': 'しゃ', 'shu': 'しゅ', 'sho': 'しょ',

    // Z-sounds
    'za': 'ざ', 'ji': 'じ', 'zu': 'ず', 'ze': 'ぜ', 'zo': 'ぞ',
    'ja': 'じゃ', 'ju': 'じゅ', 'jo': 'じょ',

    // T-sounds
    'ta': 'た', 'chi': 'ち', 'tsu': 'つ', 'te': 'て', 'to': 'と',
    'cha': 'ちゃ', 'chu': 'ちゅ', 'cho': 'ちょ',

    // D-sounds
    'da': 'だ', 'di': 'ぢ', 'du': 'づ', 'de': 'で', 'do': 'ど',

    // N-sounds
    'na': 'な', 'ni': 'に', 'nu': 'ぬ', 'ne': 'ね', 'no': 'の',
    'nya': 'にゃ', 'nyu': 'にゅ', 'nyo': 'にょ',

    // H-sounds
    'ha': 'は', 'hi': 'ひ', 'fu': 'ふ', 'he': 'へ', 'ho': 'ほ',
    'hya': 'ひゃ', 'hyu': 'ひゅ', 'hyo': 'ひょ',

    // B-sounds
    'ba': 'ば', 'bi': 'び', 'bu': 'ぶ', 'be': 'べ', 'bo': 'ぼ',
    'bya': 'びゃ', 'byu': 'びゅ', 'byo': 'びょ',

    // P-sounds
    'pa': 'ぱ', 'pi': 'ぴ', 'pu': 'ぷ', 'pe': 'ぺ', 'po': 'ぽ',
    'pya': 'ぴゃ', 'pyu': 'ぴゅ', 'pyo': 'ぴょ',

    // M-sounds
    'ma': 'ま', 'mi': 'み', 'mu': 'む', 'me': 'め', 'mo': 'も',
    'mya': 'みゃ', 'myu': 'みゅ', 'myo': 'みょ',

    // Y-sounds
    'ya': 'や', 'yu': 'ゆ', 'yo': 'よ',

    // R-sounds
    'ra': 'ら', 'ri': 'り', 'ru': 'る', 're': 'れ', 'ro': 'ろ',
    'rya': 'りゃ', 'ryu': 'りゅ', 'ryo': 'りょ',

    // W-sounds
    'wa': 'わ', 'wi': 'ゐ', 'we': 'ゑ', 'wo': 'を',

    // N
    'n': 'ん',

    // Small tsu (double consonant marker)
    'tta': 'った', 'tte': 'って', 'tto': 'っと', 'ttu': 'っつ',
    'kka': 'っか', 'kki': 'っき', 'kku': 'っく', 'kke': 'っけ', 'kko': 'っこ',
    'ssa': 'っさ', 'sshi': 'っし', 'ssu': 'っす', 'sse': 'っせ', 'sso': 'っそ',
    'ppa': 'っぱ', 'ppi': 'っぴ', 'ppu': 'っぷ', 'ppe': 'っぺ', 'ppo': 'っぽ'
};

// Romaji to Katakana mapping (for foreign words)
const ROMAJI_TO_KATAKANA = {
    // Vowels
    'a': 'ア', 'i': 'イ', 'u': 'ウ', 'e': 'エ', 'o': 'オ',

    // K-sounds
    'ka': 'カ', 'ki': 'キ', 'ku': 'ク', 'ke': 'ケ', 'ko': 'コ',
    'kya': 'キャ', 'kyu': 'キュ', 'kyo': 'キョ',

    // G-sounds
    'ga': 'ガ', 'gi': 'ギ', 'gu': 'グ', 'ge': 'ゲ', 'go': 'ゴ',
    'gya': 'ギャ', 'gyu': 'ギュ', 'gyo': 'ギョ',

    // S-sounds
    'sa': 'サ', 'shi': 'シ', 'su': 'ス', 'se': 'セ', 'so': 'ソ',
    'sha': 'シャ', 'shu': 'シュ', 'sho': 'ショ',

    // Z-sounds
    'za': 'ザ', 'ji': 'ジ', 'zu': 'ズ', 'ze': 'ゼ', 'zo': 'ゾ',
    'ja': 'ジャ', 'ju': 'ジュ', 'jo': 'ジョ',

    // T-sounds
    'ta': 'タ', 'chi': 'チ', 'tsu': 'ツ', 'te': 'テ', 'to': 'ト',
    'cha': 'チャ', 'chu': 'チュ', 'cho': 'チョ',

    // D-sounds
    'da': 'ダ', 'di': 'ヂ', 'du': 'ヅ', 'de': 'デ', 'do': 'ド',

    // N-sounds
    'na': 'ナ', 'ni': 'ニ', 'nu': 'ヌ', 'ne': 'ネ', 'no': 'ノ',
    'nya': 'ニャ', 'nyu': 'ニュ', 'nyo': 'ニョ',

    // H-sounds
    'ha': 'ハ', 'hi': 'ヒ', 'fu': 'フ', 'he': 'ヘ', 'ho': 'ホ',
    'hya': 'ヒャ', 'hyu': 'ヒュ', 'hyo': 'ヒョ',

    // B-sounds
    'ba': 'バ', 'bi': 'ビ', 'bu': 'ブ', 'be': 'ベ', 'bo': 'ボ',
    'bya': 'ビャ', 'byu': 'ビュ', 'byo': 'ビョ',

    // P-sounds
    'pa': 'パ', 'pi': 'ピ', 'pu': 'プ', 'pe': 'ペ', 'po': 'ポ',
    'pya': 'ピャ', 'pyu': 'ピュ', 'pyo': 'ピョ',

    // M-sounds
    'ma': 'マ', 'mi': 'ミ', 'mu': 'ム', 'me': 'メ', 'mo': 'モ',
    'mya': 'ミャ', 'myu': 'ミュ', 'myo': 'ミョ',

    // Y-sounds
    'ya': 'ヤ', 'yu': 'ユ', 'yo': 'ヨ',

    // R-sounds
    'ra': 'ラ', 'ri': 'リ', 'ru': 'ル', 're': 'レ', 'ro': 'ロ',
    'rya': 'リャ', 'ryu': 'リュ', 'ryo': 'リョ',

    // W-sounds
    'wa': 'ワ', 'wi': 'ヰ', 'we': 'ヱ', 'wo': 'ヲ',

    // N
    'n': 'ン',

    // V-sounds (katakana-specific for foreign words)
    'va': 'ヴァ', 'vi': 'ヴィ', 'vu': 'ヴ', 've': 'ヴェ', 'vo': 'ヴォ',

    // Extended sounds
    'fa': 'ファ', 'fi': 'フィ', 'fe': 'フェ', 'fo': 'フォ',

    // Long vowel marker
    '-': 'ー'
};

/**
 * Detect if a string contains romaji (Latin characters)
 * @param {String} text - Text to check
 * @returns {Boolean} True if text appears to be romaji
 */
export function isRomaji(text) {
    if (!text) return false;

    // Check if text contains Latin characters (a-z, A-Z)
    const hasLatin = /[a-zA-Z]/.test(text);

    // Check if text contains Japanese characters
    const hasJapanese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(text);

    // It's romaji if it has Latin characters and no Japanese
    return hasLatin && !hasJapanese;
}

/**
 * Convert romaji to hiragana
 * @param {String} romaji - Romaji text to convert
 * @returns {String} Converted hiragana text
 */
export function romajiToHiragana(romaji) {
    if (!romaji) return '';

    let result = '';
    let text = romaji.toLowerCase().trim();
    let i = 0;

    while (i < text.length) {
        // Try to match 3-character combinations first (like 'kya', 'sha')
        let matched = false;

        for (let len = 3; len >= 1; len--) {
            const substr = text.substring(i, i + len);

            if (ROMAJI_TO_HIRAGANA[substr]) {
                result += ROMAJI_TO_HIRAGANA[substr];
                i += len;
                matched = true;
                break;
            }
        }

        if (!matched) {
            // Keep non-romaji characters as-is (spaces, punctuation, etc.)
            result += text[i];
            i++;
        }
    }

    return result;
}

/**
 * Convert romaji to katakana (for foreign words, artist names, etc.)
 * @param {String} romaji - Romaji text to convert
 * @returns {String} Converted katakana text
 */
export function romajiToKatakana(romaji) {
    if (!romaji) return '';

    let result = '';
    let text = romaji.toLowerCase().trim();
    let i = 0;

    while (i < text.length) {
        // Try to match 3-character combinations first
        let matched = false;

        for (let len = 3; len >= 1; len--) {
            const substr = text.substring(i, i + len);

            if (ROMAJI_TO_KATAKANA[substr]) {
                result += ROMAJI_TO_KATAKANA[substr];
                i += len;
                matched = true;
                break;
            }
        }

        if (!matched) {
            // Handle long vowel markers
            if (text[i] === '-' || text[i] === '̄') {
                result += 'ー';
                i++;
            } else {
                // Keep non-romaji characters as-is
                result += text[i];
                i++;
            }
        }
    }

    return result;
}

/**
 * Convert romaji to both hiragana and katakana variants
 * Returns an array of possible Japanese conversions
 * @param {String} romaji - Romaji text to convert
 * @returns {Array} Array of converted variants
 */
export function romajiToJapaneseVariants(romaji) {
    if (!romaji || !isRomaji(romaji)) {
        return [romaji]; // Return original if not romaji
    }

    const variants = [];

    // Add original
    variants.push(romaji);

    // Add hiragana version
    const hiragana = romajiToHiragana(romaji);
    if (hiragana && hiragana !== romaji) {
        variants.push(hiragana);
    }

    // Add katakana version
    const katakana = romajiToKatakana(romaji);
    if (katakana && katakana !== romaji && katakana !== hiragana) {
        variants.push(katakana);
    }

    return variants;
}

/**
 * Generate search variants for artist, album, and title
 * Useful for MusicBrainz searches with Japanese music
 * @param {Object} metadata - Object with artist, album, title
 * @returns {Array} Array of search variant objects
 */
export function generateJapaneseSearchVariants(metadata) {
    const { artist, album, title } = metadata;

    const artistVariants = romajiToJapaneseVariants(artist);
    const albumVariants = romajiToJapaneseVariants(album);
    const titleVariants = romajiToJapaneseVariants(title);

    const searchVariants = [];

    // Generate all combinations
    for (const a of artistVariants) {
        for (const al of albumVariants) {
            for (const t of titleVariants) {
                searchVariants.push({
                    artist: a,
                    album: al,
                    title: t
                });
            }
        }
    }

    return searchVariants;
}

console.log('[Romaji Converter] Module loaded');
