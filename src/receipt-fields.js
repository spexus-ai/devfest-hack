export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export const validTime = (value) => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);

// Time ranges are a rule of thumb for suggesting a meal type in the demo.
export function mealTypeAt(time) {
  if (!validTime(time)) return null;
  const hour = Number(time.slice(0, 2));
  if (hour < 5) return null;
  return hour < 11 ? 'breakfast' : hour < 16 ? 'lunch' : 'dinner';
}
