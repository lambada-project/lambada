#!/usr/bin/env node

import mri from 'mri';
import { basename, resolve } from 'path';
// import { error, info, log } from './helpers/logging';
import { isDirectory } from './helpers';
// import { createPackageName } from './helpers';
import { create } from './create';

const argv = process.argv.slice(2);
const args = mri(argv, {
  alias: {
    h: 'help',
  },
});

const mainArg = args['_'][0] || '';

let nameArg: string;
let baseDir = process.cwd();
let newDir = true;

function createPackageName(name: string) {
  return name.trim().split(' ').join('-').toLowerCase();
}

if (mainArg === '.' || mainArg === './' || mainArg === '') {
  baseDir = resolve('./');
  nameArg = createPackageName(basename(baseDir));
  newDir = false;
} else if (isDirectory(mainArg)) {
  nameArg = createPackageName(basename(mainArg));
  baseDir = resolve(mainArg);
  newDir = false;
} else {
  nameArg = args['_'].join('-');
  nameArg = createPackageName(nameArg);
}

if (!nameArg || nameArg.length === 0) {
  console.error('You need to specify a valid package name');
  process.exit(9);
}

console.info(`Creating a new Lambada app with name ${nameArg}`);

create(nameArg, 'empty' ,{ baseDir, newDir });