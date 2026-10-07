import { discordPayload, discordWebhookUrl, excerpt } from './discord';

describe('discord rules', () => {
  it('picks the event URL, then default, then none', () => {
    const urls = { default: 'https://d/x', on_new_comment: 'https://d/c' };
    expect(discordWebhookUrl(urls, 'on_new_comment')).toBe('https://d/c');
    expect(discordWebhookUrl(urls, 'on_new_blogpost')).toBe('https://d/x');
    expect(discordWebhookUrl({}, 'on_new_blogpost')).toBeNull();
  });

  it('builds one embed in the legacy colour, author optional', () => {
    expect(
      discordPayload({
        title: 'New comment',
        description: 'Hi',
        author: { name: 'alice', url: 'https://site/user/alice' },
      }),
    ).toEqual({
      embeds: [
        {
          title: 'New comment',
          description: 'Hi',
          color: 0x03b2f8,
          author: { name: 'alice', url: 'https://site/user/alice' },
        },
      ],
      allowed_mentions: { parse: [] },
    });
    expect(
      discordPayload({ title: 'T', description: 'D', author: null }).embeds[0],
    ).not.toHaveProperty('author');
  });

  it('cuts by code points like a Python slice', () => {
    expect(excerpt('a😀bc', 2)).toBe('a😀');
    expect(excerpt('ab', 200)).toBe('ab');
  });
});
