// Task "moods": each reminder gets a theme from its text, which drives the colours, particles and motion.
export const THEMES = {
  water:   { css: '#4fc3f7', color: 0x4fc3f7, motion: 'bounce', rain: true,  emoji: ['💧', '💦', '🫧'] },
  meeting: { css: '#ffb74d', color: 0xffb74d, motion: 'shake',  emoji: ['🔔', '📞', '⏰'] },
  food:    { css: '#ff8a65', color: 0xff8a65, motion: 'spin',   emoji: ['🍔', '🍕', '🍜', '🥗'] },
  code:    { css: '#9c7bff', color: 0x9c7bff, motion: 'nod',    emoji: ['{ }', '</>', '💻', '⌨️'] },
  fit:     { css: '#66bb6a', color: 0x66bb6a, motion: 'bounce', emoji: ['💪', '🏃', '🔥'] },
  rest:    { css: '#b39ddb', color: 0xb39ddb, motion: 'sway',   emoji: ['😴', '☕', '🌙'] },
  task:    { css: '#64b5f6', color: 0x64b5f6, motion: 'wiggle', emoji: ['⭐', '✨', '📝', '✅'] }
};

const RULES = [
  ['meeting', /\b(stand-?up|meeting|call|sync|interview|demo|zoom|teams|catch-?up)\b/i],
  ['food', /\b(lunch|dinner|breakfast|eat|snack|meal)\b/i],
  ['code', /\b(pr|push|commit|branch|deploy|merge|code|bug|review|release|build|test|flow)\b/i],
  ['fit', /\b(gym|walk|stretch|exercise|run|workout|yoga|steps)\b/i],
  ['rest', /\b(sleep|bed|rest|break|relax|coffee|tea|nap)\b/i]
];

export function themeFor(reminder) {
  if (reminder.kind === 'water') return 'water';
  const hit = RULES.find(([, re]) => re.test(reminder.text || ''));
  return hit ? hit[0] : 'task';
}
