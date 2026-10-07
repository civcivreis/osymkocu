export const QUICK_EMOJIS = ['🔥', '🎯', '📚', '🧠', '✍️', '✅', '😂', '😭', '💪', '👀', '☕'] as const;

export const REACTION_EMOJIS = ['❤️', '😂', '👍', '😮', '😢', '🔥'] as const;

export type EmojiCategory = {
  id: string;
  label: string;
  emojis: string[];
};

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: 'faces',
    label: 'Yüzler',
    emojis: ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '😉', '😍', '🥰', '😘', '😜', '🤪', '😎', '🤩', '🤔', '😐', '😑', '😮', '😯', '😲', '😢', '😭', '😤', '😡', '🤯', '😴', '🥱', '🤗', '🤫', '🤭', '🙄', '😬'],
  },
  {
    id: 'hands',
    label: 'El / Reaksiyon',
    emojis: ['👍', '👎', '👏', '🙌', '🙏', '💪', '✌️', '🤞', '👌', '👋', '🤝', '👀', '🔥', '💯', '✨', '⭐', '🎉', '✅', '❌', '⚡'],
  },
  {
    id: 'hearts',
    label: 'Kalpler / Semboller',
    emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '💕', '💖', '💗', '💘', '💝', '😇', '🌸', '☀️', '🌙', '⭐', '🌟'],
  },
  {
    id: 'study',
    label: 'Ders / Çalışma',
    emojis: ['📚', '📖', '🧠', '✍️', '📝', '✏️', '📌', '🎯', '⏰', '☕', '✅', '📊', '📈', '💡', '🏆', '🎓', '📎', '📋', '🔍', '💪'],
  },
  {
    id: 'other',
    label: 'Diğer',
    emojis: ['🍀', '🌈', '🍕', '🍫', '🎧', '🎵', '📱', '💻', '🏠', '🚗', '✈️', '🌍', '🐶', '🐱', '🌻', '🎈', '🎁', '💤', '🥲', '😏'],
  },
];
