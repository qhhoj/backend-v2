import { discordWebhookUrl, excerpt } from './discord';

describe('discord rules', () => {
  it('picks the event URL, then default, then none', () => {
    const urls = { default: 'https://d/x', on_new_comment: 'https://d/c' };
    expect(discordWebhookUrl(urls, 'on_new_comment')).toBe('https://d/c');
    expect(discordWebhookUrl(urls, 'on_new_blogpost')).toBe('https://d/x');
    expect(discordWebhookUrl({}, 'on_new_blogpost')).toBeNull();
  });

  it('cuts by code points like a Python slice', () => {
    expect(excerpt('a😀bc', 2)).toBe('a😀');
    expect(excerpt('ab', 200)).toBe('ab');
  });
});
