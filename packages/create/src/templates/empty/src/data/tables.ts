import { EmbroideryTables, TableDefinition } from "@lambada/core/dist/database";

export const tables: EmbroideryTables & {
    "test-table": TableDefinition
} = {
    "test-table": {
        name: 'test-table',
        envKeyName: 'TEST_TABLE_NAME',
        primaryKey: 'userId'
    }
}

