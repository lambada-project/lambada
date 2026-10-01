#!/usr/bin/env node
import { readFileSync } from 'fs'
import { withIndexKeySchemas } from '../database/indexKeySchemasState'

const { state, patched } = withIndexKeySchemas(JSON.parse(readFileSync(0, 'utf8')))

process.stderr.write(`${patched} index entries now state keySchemas\n`)
process.stdout.write(JSON.stringify(state, null, 2))
