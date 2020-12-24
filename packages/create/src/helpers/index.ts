import { statSync, readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

export function isDirectory(dir: string): boolean {
  try {
    const checkDir = statSync(dir);

    if (checkDir.isDirectory()) {
      return true;
    }

    return false;
  } catch (error) {
    return false;
  }
}

export function readFile(path: string) {
  return readFileSync(resolve(__dirname, '..', 'templates', path)).toString();
}

export function readDir(path: string) {
  return readdirSync(resolve(__dirname, '..', 'templates', path));
}