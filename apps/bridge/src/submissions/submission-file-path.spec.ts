import { submissionFilePath } from './submission-file-path';

describe('submissionFilePath', () => {
  const env = { mediaRoot: '/srv/media', mediaUrl: '/media' };

  it('maps a stored media URL to its file under MEDIA_ROOT/submission_file', () => {
    expect(
      submissionFilePath(env, '/media/submission_file/sum/0192-u/a1b2.zip'),
    ).toBe('/srv/media/submission_file/sum/0192-u/a1b2.zip');
    expect(
      submissionFilePath(
        { mediaRoot: '/srv/media', mediaUrl: 'https://cdn.test/m' },
        'https://cdn.test/m/submission_file/sum/u/x.txt',
      ),
    ).toBe('/srv/media/submission_file/sum/u/x.txt');
  });

  it.each([
    '/submission_file/sum/u/x.txt',
    '/media/other/sum/u/x.txt',
    '/media/submission_file/sum/../../etc/passwd',
    '/media/submission_file/sum//x.txt',
    '/media/submission_file/.hidden/u/x',
  ])('refuses %s', (url) => expect(submissionFilePath(env, url)).toBeNull());
});
