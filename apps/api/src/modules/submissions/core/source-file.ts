/** A submission's source text with the name it is saved under. */
export interface SourceFile {
  filename: string;
  text: string;
}

/** Java needs the file named after its public class, which every submission calls `Main`. */
const JAVA_FILENAME = 'Main.java';

/** `<submission id>.<language extension>`; a language without an extension gets `.txt`. */
export function sourceFilename(id: string, extension = ''): string {
  if (extension === 'java') return JAVA_FILENAME;
  return `${id}.${extension || 'txt'}`;
}
