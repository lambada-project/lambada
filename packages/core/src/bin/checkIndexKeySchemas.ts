#!/usr/bin/env node
import { readFileSync } from 'fs'
import { indexesWithoutKeySchemas } from '../database/indexKeySchemasState'

const missing = indexesWithoutKeySchemas(JSON.parse(readFileSync(0, 'utf8')))

for (const { table, index } of missing) {
    process.stderr.write(`${table}: index ${index} records hashKey without keySchemas\n`)
}
process.exit(missing.length ? 1 : 0)
