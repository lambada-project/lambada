import * as aws from "@pulumi/aws";
import { DatabaseResult, DatabaseResultItem } from '.'
import { marshall } from '@aws-sdk/util-dynamodb'

export function seedData(databases: DatabaseResult) {
    for (const key in databases) {
        if (databases.hasOwnProperty(key)) {
            const table = databases[key];
            seed(table)
        }
    }
}

function seed(table: DatabaseResultItem) {
    if (table.definition.data) {
        for (let i = 0; i < table.definition.data.length; i++) {
            const element = table.definition.data[i];
            new aws.dynamodb.TableItem(`dataseed-${table.definition.name}-${i}`, {
                hashKey: table.ref.hashKey,
                item: typeof element === 'string' ? element : JSON.stringify(marshall(element, {removeUndefinedValues:true} )),
                tableName: table.ref.name,
            });
        }
    }
}