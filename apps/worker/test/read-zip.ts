import yauzl from 'yauzl';
import type { Entry } from 'yauzl';

/** Entry name to text of every file in the zip. */
export const readZip = (path: string): Promise<Record<string, string>> =>
  new Promise((resolve, reject) =>
    yauzl.open(path, { lazyEntries: true }, (openError, zip) => {
      if (openError) return reject(openError);
      const files: Record<string, string> = {};
      zip.on('error', reject);
      zip.on('end', () => resolve(files));
      zip.on('entry', (entry: Entry) =>
        zip.openReadStream(entry, (readError, stream) => {
          if (readError) return reject(readError);
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('error', reject);
          stream.on('end', () => {
            files[entry.fileName] = Buffer.concat(chunks).toString('utf8');
            zip.readEntry();
          });
        }),
      );
      zip.readEntry();
    }),
  );
