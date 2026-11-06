import { discordWebhookUrl } from './discord';

describe('discord rules', () => {
  it('picks the event URL, then default, then none', () => {
    const urls = { default: 'https://d/x', on_new_comment: 'https://d/c' };
    expect(discordWebhookUrl(urls, 'on_new_comment')).toBe('https://d/c');
    expect(discordWebhookUrl(urls, 'on_new_blogpost')).toBe('https://d/x');
    expect(discordWebhookUrl({}, 'on_new_blogpost')).toBeNull();
  });
});
