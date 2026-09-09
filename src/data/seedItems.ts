import type { Item } from '../types';

/**
 * Starter list. The first four rows are read off the client's paper slip dated 9/3/26 --
 * the Kannada handwriting is a best guess, so CONFIRM these four names with the shopkeeper
 * before going live. Their rates are exact (550/5 = 110, 615/5 = 123, 50, 155), which means
 * billing 5 + 5 + 1 + 1 of them reproduces that slip's total of 1370 -- useful for the demo.
 *
 * Everything after them is ordinary kirana stock at placeholder rates, purely so the app has
 * something to show on day one. The shopkeeper edits all of it from the Items tab.
 */
export const SEED_ITEMS: Item[] = [
  { id: 'gana-enne', nameKn: 'ಗಾಣದ ಎಣ್ಣೆ', nameEn: 'Gana oil (wood-pressed)', rate: 110, unit: 'pkt' },
  { id: 'menasinakayi', nameKn: 'ಮೆಣಸಿನಕಾಯಿ', nameEn: 'Chilli', rate: 123, unit: 'kg' },
  { id: 'ot', nameKn: 'OT', nameEn: 'OT', rate: 50, unit: 'pc' },
  { id: 'j-pulse', nameKn: 'J Pulse', nameEn: 'J Pulse', rate: 155, unit: 'jar' },

  { id: 'akki', nameKn: 'ಅಕ್ಕಿ', nameEn: 'Rice', rate: 62, unit: 'kg' },
  { id: 'godhi-hittu', nameKn: 'ಗೋಧಿ ಹಿಟ್ಟು', nameEn: 'Wheat flour', rate: 48, unit: 'kg' },
  { id: 'togari-bele', nameKn: 'ತೊಗರಿ ಬೇಳೆ', nameEn: 'Toor dal', rate: 165, unit: 'kg' },
  { id: 'kadale-bele', nameKn: 'ಕಡಲೆ ಬೇಳೆ', nameEn: 'Chana dal', rate: 95, unit: 'kg' },
  { id: 'sakkare', nameKn: 'ಸಕ್ಕರೆ', nameEn: 'Sugar', rate: 45, unit: 'kg' },
  { id: 'bella', nameKn: 'ಬೆಲ್ಲ', nameEn: 'Jaggery', rate: 58, unit: 'kg' },
  { id: 'uppu', nameKn: 'ಉಪ್ಪು', nameEn: 'Salt', rate: 24, unit: 'kg' },
  { id: 'rave', nameKn: 'ರವೆ', nameEn: 'Rava / semolina', rate: 42, unit: 'kg' },
  { id: 'maida', nameKn: 'ಮೈದಾ', nameEn: 'Maida', rate: 44, unit: 'kg' },
  { id: 'kobbari-enne', nameKn: 'ಕೊಬ್ಬರಿ ಎಣ್ಣೆ', nameEn: 'Coconut oil', rate: 210, unit: 'ltr' },
  { id: 'arishina', nameKn: 'ಅರಿಶಿನ ಪುಡಿ', nameEn: 'Turmeric powder', rate: 30, unit: 'pkt' },
  { id: 'jirige', nameKn: 'ಜೀರಿಗೆ', nameEn: 'Cumin', rate: 40, unit: 'pkt' },
  { id: 'sasive', nameKn: 'ಸಾಸಿವೆ', nameEn: 'Mustard', rate: 28, unit: 'pkt' },
  { id: 'kari-menasu', nameKn: 'ಕರಿಮೆಣಸು', nameEn: 'Black pepper', rate: 90, unit: 'pkt' },
  { id: 'tea-pudi', nameKn: 'ಟೀ ಪುಡಿ', nameEn: 'Tea powder', rate: 135, unit: 'pkt' },
  { id: 'kaphi-pudi', nameKn: 'ಕಾಫಿ ಪುಡಿ', nameEn: 'Coffee powder', rate: 180, unit: 'pkt' },
  { id: 'sabunu', nameKn: 'ಸಾಬೂನು', nameEn: 'Soap', rate: 35, unit: 'pc' },
  { id: 'biskattu', nameKn: 'ಬಿಸ್ಕತ್ತು', nameEn: 'Biscuit', rate: 10, unit: 'pkt' },
  { id: 'eerulli', nameKn: 'ಈರುಳ್ಳಿ', nameEn: 'Onion', rate: 32, unit: 'kg' },
  { id: 'alugadde', nameKn: 'ಆಲೂಗಡ್ಡೆ', nameEn: 'Potato', rate: 28, unit: 'kg' },
];
