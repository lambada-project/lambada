import { EmbroideryTables } from "@lambada/core/dist/database";

export const tables: EmbroideryTables = {
    'todos': {
        name: 'todos',
        primaryKey: 'userId',
        rangeKey: 'id',
        envKeyName: 'TODOS_TABLE_NAME'
    }
}