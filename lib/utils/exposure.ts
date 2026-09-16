export function exposureLabel(value: number): string {
  if (value >= 80) return "Very High";
  if (value >= 60) return "High";
  if (value >= 40) return "Medium";
  if (value >= 20) return "Low";
  return "Very Low";
}
