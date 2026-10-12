export function safePublishingUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      ![...value].some((character) => character.charCodeAt(0) <= 32)
    );
  } catch {
    return false;
  }
}
