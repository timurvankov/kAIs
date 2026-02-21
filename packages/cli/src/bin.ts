#!/usr/bin/env node
import { createProgram } from './kais.js';

const program = createProgram();
program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
