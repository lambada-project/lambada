import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import { DatabaseResult, DatabaseResultItem } from '.'
import { Marshaller } from '@aws/dynamodb-auto-marshaller'

export function seedData(databases: DatabaseResult) {
    for (const key in databases) {
        if (databases.hasOwnProperty(key)) {
            const table = databases[key];
            seed(table)
        }
    }
}

function seed(table: DatabaseResultItem) {
    const marshaller = new Marshaller();
    if (table.definition.data) {
        for (let i = 0; i < table.definition.data.length; i++) {
            const element = table.definition.data[i];
            new aws.dynamodb.TableItem(`dataseed-${table.definition.name}-${i}`, {
                hashKey: table.awsTable.hashKey,
                item: typeof element === 'string' ? element : JSON.stringify(marshaller.marshallItem(element)),
                tableName: table.awsTable.name,
            });
        }
    }
}