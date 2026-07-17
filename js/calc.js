// TDEE / PFC target calculator tuned for resistance-training goals.

const ACTIVITY_FACTORS = {
  sedentary: 1.2,   // ほぼ運動しない
  light: 1.375,      // 週1-3回の軽い運動
  moderate: 1.55,    // 週3-5回の筋トレ/運動
  active: 1.725,     // 週6-7回の激しい運動
  very_active: 1.9,  // 毎日の激しい運動+肉体労働
};

const GOAL_CALORIE_ADJUST = {
  cut: -500,       // 減量
  maintain: 0,      // 維持
  bulk: 400,        // 増量
};

// grams of protein per kg bodyweight, by goal
const GOAL_PROTEIN_PER_KG = {
  cut: 2.2,
  maintain: 1.8,
  bulk: 2.0,
};

const FAT_RATIO_OF_CALORIES = 0.25;

export function computeBMR({ weightKg, heightCm, age, sex }) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === 'female' ? base - 161 : base + 5;
}

export function computeTargets(profile) {
  const { weightKg, heightCm, age, sex, activity, goal } = profile;
  const bmr = computeBMR({ weightKg, heightCm, age, sex });
  const activityFactor = ACTIVITY_FACTORS[activity] ?? ACTIVITY_FACTORS.moderate;
  const tdee = bmr * activityFactor;
  const calories = Math.round(tdee + (GOAL_CALORIE_ADJUST[goal] ?? 0));

  const proteinPerKg = GOAL_PROTEIN_PER_KG[goal] ?? GOAL_PROTEIN_PER_KG.maintain;
  const protein = Math.round(weightKg * proteinPerKg);
  const fatCalories = calories * FAT_RATIO_OF_CALORIES;
  const fat = Math.round(fatCalories / 9);
  const remainingCalories = calories - protein * 4 - fat * 9;
  const carbs = Math.max(0, Math.round(remainingCalories / 4));

  return { calories, protein, fat, carbs, bmr: Math.round(bmr), tdee: Math.round(tdee) };
}

export const ACTIVITY_LABELS = {
  sedentary: '座り仕事中心・運動なし',
  light: '週1-3回の軽い運動',
  moderate: '週3-5回の筋トレ・運動',
  active: '週6-7回の激しい運動',
  very_active: '毎日激しい運動+肉体労働',
};

export const GOAL_LABELS = {
  cut: '減量 (脂肪を落とす)',
  maintain: '維持',
  bulk: '増量 (筋肉を増やす)',
};
